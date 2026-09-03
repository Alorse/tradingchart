-- Migration 03: visual_settings on chart, and watchlist items with labels
-- Run this in the Supabase SQL Editor

-- Visual settings (candle colors, indicator styles, EMAs, chartType)
ALTER TABLE public.user_chart_settings
  ADD COLUMN IF NOT EXISTS visual_settings JSONB NOT NULL DEFAULT '{}';

-- Full watchlist with labels/separators (not just symbols)
ALTER TABLE public.user_watchlists
  ADD COLUMN IF NOT EXISTS items JSONB NOT NULL DEFAULT '[]';
