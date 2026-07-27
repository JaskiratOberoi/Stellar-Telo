/*
 * 25_table_telo_audit_log.sql — persistent audit trail for the Telo platform.
 *
 * Telo's `audit()` (lib/audit.ts) has always emitted a structured event for
 * every consequential action — logins, orders, payments, admin ops, report
 * access, accessioning — but only to the app log stream. This table makes the
 * same events queryable for the in-app "Audit trail" tab.
 *
 * Modelled on (and improving over) the LIS's TBL_MED_USER_ACTIVITY_LOG /
 * sp_user_activity_log: instead of one free-text FUNCTION_PERFORMED column,
 * events keep their machine-readable `kind` (e.g. 'admin.user.role',
 * 'report.pdf') plus a JSON `details` payload, so the viewer can filter by
 * category (reports / users / billing / …) rather than substring-matching
 * prose. NEVER stores passwords, card data, or full PII — identifiers and
 * outcomes only, same contract as audit() itself.
 *
 * Writes are fire-and-forget from the app (an audit insert must never fail a
 * business action), so the table has no FKs — actor_id may reference a user
 * later deleted on the LIS side, and login failures have a username but no id.
 */
IF OBJECT_ID('dbo.telo_audit_log', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.telo_audit_log (
        id        BIGINT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_telo_audit_log PRIMARY KEY,
        at        DATETIME2(3) NOT NULL CONSTRAINT DF_telo_audit_log_at DEFAULT SYSDATETIME(),
        kind      VARCHAR(60)  NOT NULL,
        /* Acting user's tbl_med_user_master.id when known. */
        actor_id  INT          NULL,
        /* Username as typed — for login.failure / rate_limited, where no id exists. */
        username  NVARCHAR(50) NULL,
        /* Remaining event fields as compact JSON ({billId:…, sid:…, …}). */
        details   NVARCHAR(2000) NULL
    );

    /* The viewer's two hot paths: newest-first per kind-prefix, and per actor. */
    CREATE NONCLUSTERED INDEX IX_telo_audit_log_kind_at
        ON dbo.telo_audit_log (kind, at DESC);
    CREATE NONCLUSTERED INDEX IX_telo_audit_log_actor_at
        ON dbo.telo_audit_log (actor_id, at DESC);
    CREATE NONCLUSTERED INDEX IX_telo_audit_log_at
        ON dbo.telo_audit_log (at DESC);
END
