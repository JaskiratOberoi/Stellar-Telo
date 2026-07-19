/*
 * One-off data fix (NOT an SP artefact — do not move into db/sql/).
 * Clears the browser-autofilled email that landed on the Moin_medicare
 * reporting user. Guarded on exact id + username + current value, so it is
 * idempotent (a second run matches nothing) and cannot touch any other row.
 */
SET NOCOUNT ON;

UPDATE dbo.tbl_med_user_master
   SET Email = ''
 WHERE id = 6854
   AND Username = 'Moin_medicare'
   AND Email = 'singhupinder@live.com';

SELECT id, Username, firstname, lastname, Email
FROM dbo.tbl_med_user_master
WHERE id = 6854;
