/**
 * Schema Weaver Migration Engine - Schema Introspection - Catalog Queries
 * https://schemaweaver.vivekmind.com/
 */
const PG_VERSION_19 = 190000;
const PG_VERSION_15 = 150000;

const PUBLICATIONS_QUERY_PG19 = `
SELECT
  p.oid,
  p.pubname AS name,
  pg_catalog.pg_get_userbyid(p.pubowner) AS owner,
  p.puballtables AS all_tables,
  p.pubinsert AS insert,
  p.pubupdate AS update,
  p.pubdelete AS delete,
  p.pubtruncate AS truncate,
  p.pubviaroot AS via_root,
  p.puballsequences AS all_sequences,
  pg_catalog.obj_description(p.oid, 'pg_publication') AS comment
FROM pg_catalog.pg_publication p
ORDER BY p.pubname
`;

const PUBLICATIONS_QUERY_PRE_PG19 = `
SELECT
  p.oid,
  p.pubname AS name,
  pg_catalog.pg_get_userbyid(p.pubowner) AS owner,
  p.puballtables AS all_tables,
  p.pubinsert AS insert,
  p.pubupdate AS update,
  p.pubdelete AS delete,
  p.pubtruncate AS truncate,
  p.pubviaroot AS via_root,
  false AS all_sequences,
  pg_catalog.obj_description(p.oid, 'pg_publication') AS comment
FROM pg_catalog.pg_publication p
ORDER BY p.pubname
`;

const PUBLICATION_TABLES_QUERY = `
SELECT
  p.pubname AS publication,
  n.nspname AS table_schema,
  c.relname AS table_name,
  pg_catalog.pg_get_expr(pr.prqual, c.oid) AS row_filter,
  pr.prattrs AS column_attnums
FROM pg_catalog.pg_publication_rel pr
JOIN pg_catalog.pg_publication p ON p.oid = pr.prpubid
JOIN pg_catalog.pg_class c ON c.oid = pr.prrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p')
ORDER BY p.pubname, n.nspname, c.relname
`;

const PUBLICATION_SCHEMAS_QUERY = `
SELECT
  p.pubname AS publication,
  n.nspname AS schema_name
FROM pg_catalog.pg_publication_namespace pn
JOIN pg_catalog.pg_publication p ON p.oid = pn.pnpubid
JOIN pg_catalog.pg_namespace n ON n.oid = pn.pnnspid
ORDER BY p.pubname, n.nspname
`;

/**
 * @param {import('pg').Pool} pool
 * @param {number} version
 * @returns {Promise<Array>}
 */
export async function queryPublications(pool, version) {
  if (version < 100000) return [];

  try {
    const publicationsQuery = version >= PG_VERSION_19 
      ? PUBLICATIONS_QUERY_PG19 
      : PUBLICATIONS_QUERY_PRE_PG19;
    
    const pubsResult = await pool.query(publicationsQuery);
    const tablesResult = await pool.query(PUBLICATION_TABLES_QUERY);
    
    let schemasResult = { rows: [] };
    if (version >= PG_VERSION_15) {
      try {
        schemasResult = await pool.query(PUBLICATION_SCHEMAS_QUERY);
      } catch (e) {
      }
    }

    const publicationMap = new Map();
    
    for (const row of pubsResult.rows) {
      publicationMap.set(row.name, {
        name: row.name,
        owner: row.owner,
        all_tables: row.all_tables,
        insert: row.insert,
        update: row.update,
        delete: row.delete,
        truncate: row.truncate,
        via_root: row.via_root,
        all_sequences: row.all_sequences || false,
        comment: row.comment,
        tables: [],
        schemas: [],
      });
    }

    for (const row of tablesResult.rows) {
      const pub = publicationMap.get(row.publication);
      if (pub) {
        const tableEntry = {
          table: `${row.table_schema}.${row.table_name}`,
        };
        if (row.row_filter) {
          tableEntry.rowFilter = row.row_filter;
        }
        if (row.column_attnums) {
          try {
            const attnums = row.column_attnums;
            if (attnums && attnums.length > 0) {
              tableEntry.columns = attnums;
            }
          } catch (e) {}
        }
        pub.tables.push(tableEntry);
      }
    }

    for (const row of schemasResult.rows) {
      const pub = publicationMap.get(row.publication);
      if (pub) {
        pub.schemas.push(row.schema_name);
      }
    }

    return Array.from(publicationMap.values());
  } catch (error) {
    return [];
  }
}
