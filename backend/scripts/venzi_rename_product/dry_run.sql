-- Read-only: what apply.sql would match. Safe to run anywhere (SELECT only).
SELECT 'products named Serpenti'            AS check, count(*)::text AS value FROM "Product" WHERE "businessId" = 'cmtlnp3t30005fb2hl90ac4tl' AND name = 'Serpenti'
UNION ALL
SELECT 'products named Emerald Serpent Ring', count(*)::text FROM "Product" WHERE "businessId" = 'cmtlnp3t30005fb2hl90ac4tl' AND name = 'Emerald Serpent Ring'
UNION ALL
SELECT 'the row: id | name | updatedAt', id || ' | ' || name || ' | ' || "updatedAt"::text FROM "Product" WHERE "businessId" = 'cmtlnp3t30005fb2hl90ac4tl' AND name = 'Serpenti'
UNION ALL
SELECT 'campaigns using it', coalesce(string_agg(coalesce(c.name,'(unnamed)') || ' [' || c.status || ']', '; '), 'none') FROM "Campaign" c JOIN "Product" p ON p.id = c."productId" WHERE p."businessId" = 'cmtlnp3t30005fb2hl90ac4tl' AND p.name = 'Serpenti';
