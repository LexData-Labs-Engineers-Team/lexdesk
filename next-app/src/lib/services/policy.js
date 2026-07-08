import { sql } from '../db';
import { tsToIso } from '../rows';
import { buildUpdateSet } from '../rows';
import { FACE_EMBEDDING_DIM, FACE_EMBEDDING_MODEL } from './face';

// Org attendance policy (single row). Ported from AttendDesk; same response
// shape (policy + face embedding metadata).

function mapPolicy(row) {
  if (!row) return null;
  return {
    requireWifi: row.require_wifi,
    requireIp: row.require_ip,
    requireGeo: row.require_geo,
    requireQr: row.require_qr,
    requireFace: row.require_face,
    faceThreshold: row.face_threshold,
    gpsAccuracyMaxMeters: row.gps_accuracy_max_meters,
    updatedAt: tsToIso(row.updated_at),
  };
}

export async function getPolicy(orgId) {
  const rows = await sql`SELECT * FROM policy WHERE org_id = ${orgId}`;
  return {
    policy: mapPolicy(rows[0] || null),
    faceEmbeddingDim: FACE_EMBEDDING_DIM,
    faceEmbeddingModel: FACE_EMBEDDING_MODEL,
  };
}

// body: { requireWifi, requireGeo, requireQr, requireFace, faceThreshold, gpsAccuracyMaxMeters }
export async function updatePolicy(body, orgId) {
  const { setClause, params } = buildUpdateSet(body, { startIndex: 2 });
  // params start at $2; $1 is org_id.
  if (setClause) {
    const text = `INSERT INTO policy (org_id, ${
      setClause.replace(/=\$\d+/g, '')
    }) VALUES ($1, ${
      params.map((_, i) => `$${i + 2}`).join(', ')
    }) ON CONFLICT (org_id) DO UPDATE SET ${setClause}, updated_at = now()`;
    await sql.query(text, [orgId, ...params]);
  } else {
    // No fields to merge: ensure a row exists (bump updated_at on conflict).
    await sql.query(
      `INSERT INTO policy (org_id) VALUES ($1) ON CONFLICT (org_id) DO UPDATE SET updated_at = now()`,
      [orgId]
    );
  }
  const rows = await sql`SELECT * FROM policy WHERE org_id = ${orgId}`;
  return {
    policy: mapPolicy(rows[0] || null),
    faceEmbeddingDim: FACE_EMBEDDING_DIM,
    faceEmbeddingModel: FACE_EMBEDDING_MODEL,
  };
}
