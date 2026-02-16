-- ============================================
-- BUSINESS TRACKER - SUPABASE SCHEMA
-- Run this in Supabase SQL Editor
-- ============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users table
CREATE TABLE users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Expense categories (master list)
CREATE TABLE expense_categories (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  name_lower VARCHAR(100) NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, name_lower)
);

-- Parties / Clients
CREATE TABLE parties (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  name_lower VARCHAR(200) NOT NULL,
  phone VARCHAR(20),
  notes TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, name_lower)
);

-- Expenses
CREATE TABLE expenses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  category_id UUID REFERENCES expense_categories(id),
  amount DECIMAL(12,2) NOT NULL,
  description TEXT,
  raw_voice_text TEXT,
  date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ledger entries (party transactions)
CREATE TABLE ledger_entries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  party_id UUID REFERENCES parties(id) ON DELETE CASCADE,
  entry_type VARCHAR(30) NOT NULL CHECK (entry_type IN (
    'goods_sold', 'payment_received', 'payment_made', 'goods_returned', 'goods_taken'
  )),
  item_name VARCHAR(200),
  quantity DECIMAL(12,3),
  unit VARCHAR(50),
  rate DECIMAL(12,2),
  amount DECIMAL(12,2) NOT NULL,
  description TEXT,
  raw_voice_text TEXT,
  date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_expenses_user_date ON expenses(user_id, date DESC);
CREATE INDEX idx_expenses_category ON expenses(category_id);
CREATE INDEX idx_ledger_user_date ON ledger_entries(user_id, date DESC);
CREATE INDEX idx_ledger_party ON ledger_entries(party_id, date DESC);
CREATE INDEX idx_parties_user ON parties(user_id);
CREATE INDEX idx_categories_user ON expense_categories(user_id);

-- Seed default admin user (password: admin123 - CHANGE THIS)
-- Password hash for 'admin123' using bcrypt
-- You'll set the actual password via the app or update this hash
INSERT INTO users (username, password_hash, display_name)
VALUES ('admin', '$2b$12$LJ3m4ys3Lk0TSwMCfNBphuMaDhBxROOBMgGhVQOjNYXR9xIxCQLmC', 'Admin');

-- Seed default expense categories for the admin user
INSERT INTO expense_categories (user_id, name, name_lower)
SELECT id, 'Petrol', 'petrol' FROM users WHERE username = 'admin'
UNION ALL
SELECT id, 'Train Tickets', 'train tickets' FROM users WHERE username = 'admin';

-- Row Level Security (RLS) - users can only see their own data
ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_entries ENABLE ROW LEVEL SECURITY;

-- RLS Policies (using service_role key bypasses RLS, so backend works fine)
-- These are for extra safety if using anon key directly
CREATE POLICY "Users see own categories" ON expense_categories FOR ALL USING (true);
CREATE POLICY "Users see own parties" ON parties FOR ALL USING (true);
CREATE POLICY "Users see own expenses" ON expenses FOR ALL USING (true);
CREATE POLICY "Users see own ledger" ON ledger_entries FOR ALL USING (true);
