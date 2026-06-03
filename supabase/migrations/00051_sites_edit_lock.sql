  -- Edit lock for the site composer.
  --
  -- WHY: when sales / IT / a client all have access to the same site, two of
  -- them opening the composer simultaneously means one of their saves silently
  -- overwrites the other. This adds a row-level "currently being edited by"
  -- signal we can read on page mount and surface to the second person as a
  -- read-only "Currently in use" screen instead of letting them edit.
  --
  -- HOW THE LOCK BEHAVES:
  --   - First user to open the composer claims the lock (writes locked_by_*).
  --   - That user's tab heartbeats every 30s, refreshing lock_heartbeat_at.
  --   - If heartbeats stop for >90s (tab crashed, lost network, closed without
  --     a clean release), the lock is considered stale and any user can claim.
  --   - Same-user re-acquires (reload, second tab) succeed without contention
  --     so the user isn't locked out by their own browser.
  --
  -- The RPC at the bottom is the only entry point — it does the read +
  -- conditional update inside one Postgres transaction (FOR UPDATE row lock),
  -- so two simultaneous openers can never both see "available" and both win.

  ALTER TABLE sites
    ADD COLUMN IF NOT EXISTS locked_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS locked_by_role text,
    ADD COLUMN IF NOT EXISTS lock_acquired_at timestamptz,
    ADD COLUMN IF NOT EXISTS lock_heartbeat_at timestamptz;

  -- Range queries on heartbeat_at need an index — every lock acquisition
  -- compares against (now - ttl).
  CREATE INDEX IF NOT EXISTS idx_sites_lock_heartbeat
    ON sites (lock_heartbeat_at);

  /**
  * Atomic acquire-or-heartbeat. Returns one of:
  *   { status: 'acquired' }                                        — caller now holds the lock
  *   { status: 'held_by_other', team: text, since: timestamptz }   — someone else holds it
  *
  * Three "available" cases all succeed:
  *   1. No lock at all (locked_by_user_id is null)
  *   2. Lock is stale (heartbeat older than p_ttl_seconds)
  *   3. Same user re-acquiring (reload, second tab)
  *
  * `lock_acquired_at` is preserved across same-user heartbeats so the "in
  * use since N minutes ago" display in the locked screen doesn't reset
  * every 30 seconds.
  */
  CREATE OR REPLACE FUNCTION acquire_site_lock(
    p_site_id uuid,
    p_user_id uuid,
    p_role text,
    p_ttl_seconds integer DEFAULT 90
  ) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $$
  DECLARE
    v_holder         uuid;
    v_holder_role    text;
    v_heartbeat      timestamptz;
    v_acquired       timestamptz;
    v_now            timestamptz := now();
    v_stale_cutoff   timestamptz := v_now - make_interval(secs => p_ttl_seconds);
  BEGIN
    -- Row-level lock prevents two callers from both reading "available" and
    -- both winning. The lock is released when the function returns.
    SELECT locked_by_user_id, locked_by_role, lock_heartbeat_at, lock_acquired_at
      INTO v_holder, v_holder_role, v_heartbeat, v_acquired
      FROM sites
      WHERE id = p_site_id
      FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('status', 'site_not_found');
    END IF;

    -- Available paths: no lock, stale lock, or same user re-acquiring
    IF v_holder IS NULL
      OR v_heartbeat IS NULL
      OR v_heartbeat < v_stale_cutoff
      OR v_holder = p_user_id THEN
      UPDATE sites SET
        locked_by_user_id   = p_user_id,
        locked_by_role      = p_role,
        lock_heartbeat_at   = v_now,
        -- Preserve the original claim time on same-user heartbeats; reset
        -- when this is a new claim (different user OR stale takeover).
        lock_acquired_at    = CASE
          WHEN v_holder = p_user_id
            AND v_heartbeat IS NOT NULL
            AND v_heartbeat >= v_stale_cutoff
          THEN v_acquired
          ELSE v_now
        END
      WHERE id = p_site_id;

      RETURN jsonb_build_object('status', 'acquired');
    END IF;

    -- Held by a different, still-fresh user
    RETURN jsonb_build_object(
      'status', 'held_by_other',
      'team',   v_holder_role,
      'since',  v_acquired
    );
  END;
  $$;

  /**
  * Release the lock if (and only if) the calling user holds it.
  * Idempotent: returns true whether or not we actually owned it, since
  * "the lock isn't held by me anymore" is the desired post-condition
  * either way (stale lock the user lost, or never had).
  */
  CREATE OR REPLACE FUNCTION release_site_lock(
    p_site_id uuid,
    p_user_id uuid
  ) RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $$
  BEGIN
    UPDATE sites SET
      locked_by_user_id = NULL,
      locked_by_role    = NULL,
      lock_acquired_at  = NULL,
      lock_heartbeat_at = NULL
    WHERE id = p_site_id
      AND locked_by_user_id = p_user_id;

    RETURN TRUE;
  END;
  $$;

  GRANT EXECUTE ON FUNCTION acquire_site_lock(uuid, uuid, text, integer) TO authenticated;
  GRANT EXECUTE ON FUNCTION release_site_lock(uuid, uuid) TO authenticated;
