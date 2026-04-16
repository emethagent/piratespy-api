const { pool } = require('./pool');

const MIGRATIONS = [
  {
    name: '001_initial_schema',
    sql: `
      -- Users (for auth)
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
        invite_code TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Invite codes
      CREATE TABLE IF NOT EXISTS invite_codes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        code TEXT UNIQUE NOT NULL,
        created_by UUID REFERENCES users(id),
        used_by UUID REFERENCES users(id),
        used_at TIMESTAMPTZ,
        expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Meta Pages (Facebook advertiser pages)
      CREATE TABLE IF NOT EXISTS meta_pages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        page_id TEXT UNIQUE NOT NULL,
        page_name TEXT,
        page_category TEXT,
        likes INTEGER DEFAULT 0,
        profile_photo TEXT,
        cover_photo TEXT,
        page_alias TEXT,
        page_url TEXT,
        is_verified BOOLEAN DEFAULT FALSE,
        raw_data JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Meta Domains (destination websites)
      CREATE TABLE IF NOT EXISTS meta_domains (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        domain TEXT UNIQUE NOT NULL,
        is_shopify BOOLEAN DEFAULT FALSE,
        shopify_theme TEXT,
        shopify_id TEXT,
        store_name TEXT,
        main_categories TEXT[],
        language TEXT,
        storeindex_data JSONB,
        similarweb_data JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Meta Ads
      CREATE TABLE IF NOT EXISTS meta_ads (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        ad_archive_id TEXT UNIQUE NOT NULL,
        page_id TEXT REFERENCES meta_pages(page_id),
        collation_id TEXT,
        collation_count INTEGER DEFAULT 1,
        domain_id UUID REFERENCES meta_domains(id),
        title TEXT,
        body TEXT,
        link_url TEXT,
        cta_text TEXT,
        eu_total_reach INTEGER DEFAULT 0,
        start_date TIMESTAMPTZ,
        end_date TIMESTAMPTZ,
        is_active BOOLEAN DEFAULT TRUE,
        platforms TEXT[],
        media_assets JSONB DEFAULT '[]',
        media_archived BOOLEAN DEFAULT FALSE,
        raw_data JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Meta Collation Groups
      CREATE TABLE IF NOT EXISTS meta_collation_groups (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        collation_id TEXT UNIQUE NOT NULL,
        primary_ad_id TEXT REFERENCES meta_ads(ad_archive_id),
        ad_ids TEXT[] DEFAULT '{}',
        total_count INTEGER DEFAULT 0,
        total_audience INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Ads Daily Snapshots (historical tracking)
      CREATE TABLE IF NOT EXISTS meta_ads_snapshots (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        ad_archive_id TEXT NOT NULL REFERENCES meta_ads(ad_archive_id),
        snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
        eu_total_reach INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT TRUE,
        position_rank INTEGER,
        raw_aaa JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(ad_archive_id, snapshot_date)
      );

      -- Page-Domain mapping (which pages advertise for which domains)
      CREATE TABLE IF NOT EXISTS meta_page_domains (
        page_id TEXT REFERENCES meta_pages(page_id),
        domain_id UUID REFERENCES meta_domains(id),
        ads_count INTEGER DEFAULT 0,
        first_seen TIMESTAMPTZ DEFAULT NOW(),
        last_seen TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (page_id, domain_id)
      );

      -- User saved ads (swipe file)
      CREATE TABLE IF NOT EXISTS user_saved_ads (
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        ad_id UUID REFERENCES meta_ads(id) ON DELETE CASCADE,
        tags TEXT[],
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (user_id, ad_id)
      );

      -- User followed brands
      CREATE TABLE IF NOT EXISTS user_followed_brands (
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        domain_id UUID REFERENCES meta_domains(id) ON DELETE CASCADE,
        notify_discord BOOLEAN DEFAULT TRUE,
        notify_email BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (user_id, domain_id)
      );

      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_meta_ads_page_id ON meta_ads(page_id);
      CREATE INDEX IF NOT EXISTS idx_meta_ads_collation_id ON meta_ads(collation_id);
      CREATE INDEX IF NOT EXISTS idx_meta_ads_is_active ON meta_ads(is_active);
      CREATE INDEX IF NOT EXISTS idx_meta_ads_start_date ON meta_ads(start_date);
      CREATE INDEX IF NOT EXISTS idx_meta_ads_domain_id ON meta_ads(domain_id);
      CREATE INDEX IF NOT EXISTS idx_meta_ads_snapshots_date ON meta_ads_snapshots(snapshot_date);
      CREATE INDEX IF NOT EXISTS idx_meta_ads_snapshots_ad ON meta_ads_snapshots(ad_archive_id);
      CREATE INDEX IF NOT EXISTS idx_meta_domains_domain ON meta_domains(domain);
      CREATE INDEX IF NOT EXISTS idx_meta_domains_is_shopify ON meta_domains(is_shopify);

      -- Migrations tracking
      CREATE TABLE IF NOT EXISTS _migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      );
    `
  },
  {
    name: '003_user_bookmarks',
    sql: `
      CREATE TABLE IF NOT EXISTS user_bookmarks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        domain_id UUID NOT NULL REFERENCES meta_domains(id) ON DELETE CASCADE,
        tags TEXT[] DEFAULT '{}',
        notes TEXT,
        notify_discord BOOLEAN DEFAULT FALSE,
        notify_email BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, domain_id)
      );

      CREATE INDEX IF NOT EXISTS idx_user_bookmarks_user ON user_bookmarks(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_user_bookmarks_domain ON user_bookmarks(domain_id);

      -- Migrate existing data from user_followed_brands
      INSERT INTO user_bookmarks (user_id, domain_id, notify_discord, notify_email, created_at)
      SELECT user_id, domain_id, notify_discord, notify_email, created_at
      FROM user_followed_brands
      ON CONFLICT (user_id, domain_id) DO NOTHING;
    `
  },
  {
    name: '002_shopify_apps',
    sql: `
      CREATE TABLE IF NOT EXISTS shopify_apps (
        id SERIAL PRIMARY KEY,
        app_name TEXT NOT NULL,
        app_url TEXT,
        page_title TEXT,
        review_count TEXT,
        review_rating TEXT,
        description TEXT,
        prices TEXT[],
        categories TEXT[],
        logo_url TEXT,
        developer_name TEXT,
        developer_mail TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_shopify_apps_name ON shopify_apps(LOWER(app_name));
      CREATE INDEX IF NOT EXISTS idx_shopify_apps_categories ON shopify_apps USING GIN(categories);
    `
  }
];

async function migrate() {
  const client = await pool.connect();
  try {
    // Ensure migrations table exists
    await client.query(`CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT NOW())`);

    for (const migration of MIGRATIONS) {
      const { rows } = await client.query('SELECT name FROM _migrations WHERE name = $1', [migration.name]);
      if (rows.length === 0) {
        console.log(`Running migration: ${migration.name}`);
        await client.query(migration.sql);
        await client.query('INSERT INTO _migrations (name) VALUES ($1)', [migration.name]);
        console.log(`Migration ${migration.name} applied`);
      }
    }
    console.log('All migrations up to date');
  } finally {
    client.release();
  }
}

module.exports = { migrate };
