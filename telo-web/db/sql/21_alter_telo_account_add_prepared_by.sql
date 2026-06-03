/*
 * 21_alter_telo_account_add_prepared_by.sql
 *
 * Per-account "Prepared by" override on the Telo sidecar dbo.telo_account.
 * When set, this string is printed as the bill's "Prepared By" for every order
 * the account registers — overriding both the auto-filled registering-user
 * name (firstname + lastname) and the per-MCC invoice-config "prepared_by".
 *
 * Why per-account: one client code (e.g. MDCARE / MCC 5797) is shared by
 * multiple Telo logins (medicare_reception, _reception2, _reception3, …). The
 * per-MCC config is a single value for the whole client and the auto-derived
 * name is just the LIS first/last name — neither lets each account print its
 * own "Prepared By". This column does.
 *
 * Purely additive: a NULLABLE NVARCHAR(120) (matches the invoice-config
 * prepared_by width). NULL ⇒ no override ⇒ existing behavior. No existing
 * column or data is touched; re-runs are idempotent.
 */
SET NOCOUNT ON;

IF COL_LENGTH('dbo.telo_account', 'prepared_by') IS NULL
BEGIN
    ALTER TABLE dbo.telo_account
        ADD prepared_by NVARCHAR(120) NULL;
    PRINT 'Added dbo.telo_account.prepared_by (NULL = no override).';
END
ELSE
    PRINT 'dbo.telo_account.prepared_by already present.';
GO
