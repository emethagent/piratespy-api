const { S3Client, PutObjectCommand, HeadBucketCommand, CreateBucketCommand } = require('@aws-sdk/client-s3');
const { pool } = require('../db/pool');
const https = require('https');
const http = require('http');

const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: 'us-east-1',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY,
    secretAccessKey: process.env.S3_SECRET_KEY,
  },
  forcePathStyle: true,
});

const BUCKET = process.env.S3_BUCKET || 'piratespy-media';
const PUBLIC_URL = process.env.S3_PUBLIC_URL;

let bucketReady = false;

async function ensureBucket() {
  if (bucketReady) return;
  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
    bucketReady = true;
  } catch (err) {
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
      await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
      console.log(`Bucket ${BUCKET} created`);
      bucketReady = true;
    } else {
      console.error('S3 bucket check failed:', err.message);
    }
  }
}

function downloadFile(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { timeout: 30000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadFile(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }

      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({
        buffer: Buffer.concat(chunks),
        contentType: res.headers['content-type'] || 'application/octet-stream',
      }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Download timeout')); });
  });
}

function getExtension(url, contentType) {
  if (contentType?.includes('video/mp4') || url.includes('.mp4')) return '.mp4';
  if (contentType?.includes('video/webm')) return '.webm';
  if (contentType?.includes('image/jpeg') || url.includes('.jpg')) return '.jpg';
  if (contentType?.includes('image/png') || url.includes('.png')) return '.png';
  if (contentType?.includes('image/webp') || url.includes('.webp')) return '.webp';
  if (contentType?.includes('video/')) return '.mp4';
  if (contentType?.includes('image/')) return '.jpg';
  return '';
}

async function archiveMediaForAd(adArchiveId) {
  try {
    await ensureBucket();

    const { rows } = await pool.query(
      'SELECT ad_archive_id, media_assets, media_archived FROM meta_ads WHERE ad_archive_id = $1',
      [adArchiveId]
    );

    if (rows.length === 0) return;
    const ad = rows[0];

    if (ad.media_archived) return; // Already done

    const assets = ad.media_assets || [];
    if (assets.length === 0) {
      await pool.query('UPDATE meta_ads SET media_archived = true WHERE ad_archive_id = $1', [adArchiveId]);
      return;
    }

    const updatedAssets = [];
    let allArchived = true;

    for (let i = 0; i < assets.length; i++) {
      const asset = assets[i];
      const originalUrl = asset.url;

      if (!originalUrl || asset.archived_url) {
        updatedAssets.push(asset);
        continue;
      }

      try {
        const { buffer, contentType } = await downloadFile(originalUrl);
        const ext = getExtension(originalUrl, contentType);
        const key = `ads/${adArchiveId}/${asset.type}_${i}${ext}`;

        await s3.send(new PutObjectCommand({
          Bucket: BUCKET,
          Key: key,
          Body: buffer,
          ContentType: contentType,
        }));

        updatedAssets.push({
          ...asset,
          archived_url: `${PUBLIC_URL}/${key}`,
          original_url: originalUrl,
          archived_at: new Date().toISOString(),
          file_size: buffer.length,
        });
      } catch (dlErr) {
        console.error(`Failed to archive ${asset.type} for ad ${adArchiveId}:`, dlErr.message);
        updatedAssets.push(asset);
        allArchived = false;
      }
    }

    await pool.query(
      'UPDATE meta_ads SET media_assets = $1, media_archived = $2, updated_at = NOW() WHERE ad_archive_id = $3',
      [JSON.stringify(updatedAssets), allArchived, adArchiveId]
    );

    if (allArchived) {
      console.log(`Archived ${updatedAssets.length} media for ad ${adArchiveId}`);
    }
  } catch (err) {
    console.error(`Media archive error for ${adArchiveId}:`, err.message);
  }
}

// Queue for background processing
const queue = [];
let processing = false;

function enqueueArchive(adArchiveId) {
  if (!queue.includes(adArchiveId)) {
    queue.push(adArchiveId);
    processQueue();
  }
}

async function processQueue() {
  if (processing || queue.length === 0) return;
  processing = true;

  while (queue.length > 0) {
    const adId = queue.shift();
    try {
      await archiveMediaForAd(adId);
    } catch (err) {
      console.error('Queue processing error:', err.message);
    }
    // Small delay between downloads to avoid hammering Facebook CDN
    await new Promise(r => setTimeout(r, 500));
  }

  processing = false;
}

module.exports = { enqueueArchive, archiveMediaForAd };
