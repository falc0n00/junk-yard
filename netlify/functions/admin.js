import { supabaseAdmin } from './_supabase.js';

// ---------- Auth helper ----------
// Verifies the Bearer token AND that the user has the "admin" role.
async function requireAdmin(req) {
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
  if (!authHeader) return { error: 'Missing auth token', status: 401 };

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return { error: 'Invalid token', status: 401 };

  const { data: roles } = await supabaseAdmin
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .eq('role', 'admin');

  if (!roles || roles.length === 0) return { error: 'Admin only', status: 403 };

  return { user };
}

export default async (req) => {
  // Every route here requires admin
  const auth = await requireAdmin(req);
  if (auth.error) return json({ error: auth.error }, auth.status);

  const url = new URL(req.url);

  // ---------- GET /api/admin ----------
  // Overview: all sellers with listing + rating counts
  if (req.method === 'GET') {
    const { data: sellers, error } = await supabaseAdmin
      .from('sellers')
      .select(`
        id, name, phone, suspended, created_at,
        listings (id, status),
        ratings (stars)
      `)
      .order('created_at', { ascending: false });

    if (error) return json({ error: error.message }, 500);

    const enriched = sellers.map((s) => {
      const totalRatings = s.ratings?.length || 0;
      const avg = totalRatings
        ? s.ratings.reduce((a, r) => a + r.stars, 0) / totalRatings
        : 0;
      const activeListings = (s.listings || []).filter((l) => l.status === 'active').length;
      const soldListings   = (s.listings || []).filter((l) => l.status === 'sold').length;
      return {
        id: s.id,
        name: s.name,
        phone: s.phone,
        suspended: s.suspended,
        created_at: s.created_at,
        listings_total:  (s.listings || []).length,
        listings_active: activeListings,
        listings_sold:   soldListings,
        ratings_count:   totalRatings,
        ratings_avg:     avg,
      };
    });

    // Global stats
    const { count: listingCount } = await supabaseAdmin
      .from('listings').select('*', { count: 'exact', head: true });
    const { count: sellerCount } = await supabaseAdmin
      .from('sellers').select('*', { count: 'exact', head: true });
    const { count: ratingCount } = await supabaseAdmin
      .from('ratings').select('*', { count: 'exact', head: true });

    return json({
      sellers: enriched,
      stats: {
        total_sellers: sellerCount || 0,
        total_listings: listingCount || 0,
        total_ratings: ratingCount || 0,
        suspended_sellers: enriched.filter((s) => s.suspended).length,
      },
    });
  }

  // ---------- PATCH /api/admin ----------
  // Body: { action: "suspend" | "unsuspend", seller_id }
  if (req.method === 'PATCH') {
    const body = await req.json();
    const { action, seller_id } = body;
    if (!seller_id || !action) return json({ error: 'seller_id and action required' }, 400);

    let suspended;
    if (action === 'suspend')        suspended = true;
    else if (action === 'unsuspend') suspended = false;
    else return json({ error: 'Invalid action' }, 400);

    const { error } = await supabaseAdmin
      .from('sellers')
      .update({ suspended })
      .eq('id', seller_id);

    if (error) return json({ error: error.message }, 500);
    return json({ success: true, suspended });
  }

  // ---------- DELETE /api/admin ----------
  // Body: { type: "listing" | "seller" | "rating", id }
  if (req.method === 'DELETE') {
    const body = await req.json();
    const { type, id } = body;
    if (!type || !id) return json({ error: 'type and id required' }, 400);

    const table = { listing: 'listings', seller: 'sellers', rating: 'ratings' }[type];
    if (!table) return json({ error: 'Invalid type' }, 400);

    const { error } = await supabaseAdmin.from(table).delete().eq('id', id);
    if (error) return json({ error: error.message }, 500);
    return json({ success: true });
  }

  return json({ error: 'Method not allowed' }, 405);
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const config = { path: '/api/admin' };
