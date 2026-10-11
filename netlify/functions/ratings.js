import { supabaseAdmin } from './_supabase.js';

const SUSPEND_AVG = 2.0;
const SUSPEND_MIN_RATINGS = 3;

export default async (req) => {
  const url = new URL(req.url);

  // ---------- GET /api/ratings?seller_id=... ----------
  // Public: read ratings for a seller
  if (req.method === 'GET') {
    const sellerId = url.searchParams.get('seller_id');
    if (!sellerId) return json({ error: 'seller_id required' }, 400);

    const { data, error } = await supabaseAdmin
      .from('ratings')
      .select('id, stars, comment, created_at, buyer_phone')
      .eq('seller_id', sellerId)
      .order('created_at', { ascending: false });

    if (error) return json({ error: error.message }, 500);

    const count = data.length;
    const avg = count ? data.reduce((a, r) => a + r.stars, 0) / count : 0;

    return json({ ratings: data, count, avg });
  }

  // ---------- POST /api/ratings ----------
  // Public: submit a rating (with automatic suspension check)
  if (req.method === 'POST') {
    const body = await req.json();
    const { seller_id, stars, comment, buyer_phone } = body;

    if (!seller_id) return json({ error: 'seller_id required' }, 400);
    if (!stars || stars < 1 || stars > 5) return json({ error: 'stars must be 1..5' }, 400);

    // Insert the rating
    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from('ratings')
      .insert({
        seller_id,
        stars: Number(stars),
        comment: comment || null,
        buyer_phone: buyer_phone || null,
      })
      .select()
      .single();

    if (insertErr) return json({ error: insertErr.message }, 500);

    // Recompute the seller's average
    const { data: allRatings, error: fetchErr } = await supabaseAdmin
      .from('ratings')
      .select('stars')
      .eq('seller_id', seller_id);

    if (fetchErr) return json({ error: fetchErr.message }, 500);

    const count = allRatings.length;
    const avg = count ? allRatings.reduce((a, r) => a + r.stars, 0) / count : 0;

    // Auto-suspend if the threshold is crossed
    let suspendedNow = false;
    if (count >= SUSPEND_MIN_RATINGS && avg <= SUSPEND_AVG) {
      const { error: suspErr } = await supabaseAdmin
        .from('sellers')
        .update({ suspended: true })
        .eq('id', seller_id);
      if (!suspErr) suspendedNow = true;
    }

    return json({
      success: true,
      rating: inserted,
      seller_avg: avg,
      seller_count: count,
      suspended_now: suspendedNow,
    }, 201);
  }

  return json({ error: 'Method not allowed' }, 405);
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const config = { path: '/api/ratings' };
