-- Lineage query templates for the front end (sql.js). Named parameters: :id, :max_depth, :q.
-- `edges` is child -> parent, covering seed/pollen/unordered parentage and 'sport' links.

-- 1. Search (FTS4, because sql.js has no FTS5). `cultivar_list` is a materialized copy of v_cultivar_list whose
--    rowid is the FTS docid (joining through the view made counting 5-60 s in the browser). Build :q from the
--    user's words as prefix terms, e.g.  name:rob* name:sticky*  (every word must be in the NAME, the app tries
--    this first for several words) or  "rob*" "sticky*"  (anywhere). FTS4 has no bm25, so rank names that
--    contain the whole phrase ahead of other matches. :ph is the words joined by a space, e.g. 'baby pink'.
SELECT l.id, l.name, l.kind
FROM cultivars_fts f JOIN cultivar_list l ON l.rowid = f.docid
WHERE cultivars_fts MATCH :q
ORDER BY CASE WHEN l.name LIKE :ph || '%' THEN 0 WHEN l.name LIKE '%' || :ph || '%' THEN 1 ELSE 2 END,
         l.name COLLATE NOCASE
LIMIT 50;

-- 2. Ancestor graph: every edge reachable upward from :id (use :max_depth ~ 8 for drawing).
WITH RECURSIVE anc(child_id, parent_id, role, certainty, depth) AS (
  SELECT child_id, parent_id, role, certainty, 1 FROM edges WHERE child_id = :id
  UNION
  SELECT e.child_id, e.parent_id, e.role, e.certainty, anc.depth + 1
  FROM edges e JOIN anc ON e.child_id = anc.parent_id
  WHERE anc.depth < :max_depth
)
SELECT child_id, parent_id, role, certainty, MIN(depth) AS depth FROM anc
GROUP BY child_id, parent_id, role;

-- 3. Descendant graph: every edge reachable downward from :id.
WITH RECURSIVE dec(child_id, parent_id, role, certainty, depth) AS (
  SELECT child_id, parent_id, role, certainty, 1 FROM edges WHERE parent_id = :id
  UNION
  SELECT e.child_id, e.parent_id, e.role, e.certainty, dec.depth + 1
  FROM edges e JOIN dec ON e.parent_id = dec.child_id
  WHERE dec.depth < :max_depth
)
SELECT child_id, parent_id, role, certainty, MIN(depth) AS depth FROM dec
GROUP BY child_id, parent_id, role;

-- 4. Sport family: walk up from :id to the original cultivar, then list it and every sport beneath it.
WITH RECURSIVE up(id) AS (
  SELECT :id
  UNION
  SELECT c.sport_of_id FROM cultivars c JOIN up ON c.id = up.id WHERE c.sport_of_id IS NOT NULL
), fam(id, depth) AS (
  SELECT c.id, 0 FROM up JOIN cultivars c ON c.id = up.id WHERE c.sport_of_id IS NULL
  UNION
  SELECT c.id, fam.depth + 1 FROM cultivars c JOIN fam ON c.sport_of_id = fam.id
)
SELECT c.id, c.name, c.sport_of_id, fam.depth FROM fam JOIN cultivars c ON c.id = fam.id
ORDER BY fam.depth, c.name;

-- 5. Nodes for drawing: after running query 2 or 3, fetch details for the ids it returned
--    (:id plus every child_id / parent_id in the edge list), e.g. with a prepared IN (...) list:
--    SELECT id, name, kind, registration_no, sport_of_id FROM cultivars WHERE id IN (...);

-- 6. Cultivar page: the cultivar, its hybridizers, parents and direct children.
SELECT c.*, h.hybridizers FROM cultivars c
LEFT JOIN cultivar_hybridizer_names h ON h.cultivar_id = c.id WHERE c.id = :id;
SELECT * FROM v_parents WHERE child_id = :id ORDER BY role;
SELECT * FROM v_children WHERE parent_id = :id ORDER BY child_name;
