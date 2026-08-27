const { createClient } = require("@supabase/supabase-js");

const players = ["Παναοτ", "Νικ", "Κατσα", "Πλιοκας", "Τολης", "Θάνος"];
const challenges = [
  ["Να πας να μιλήσεις σε κοπέλα", 5], ["Να στείλεις μήνυμα σε κοπέλα", 3],
  ["Να βγεις με κοπέλα", 20], ["Να κάνεις κάτι με κοπέλα", 25],
  ["Να προχωρήσεις με κοπέλα", 50], ["Να πάρεις Instagram και να σε κάνει back", 10],
  ["Να φτιάξεις τον φίλο σου με κοπέλα", 7], ["Να κανονίσεις βόλτα με κοπέλες (ακόμα και φίλες)", 5],
  ["Να μπεις ΟΜΕ και να πάρεις Instagram (με back)", 2], ["Να κάνεις μια πρόκληση που συμφωνούν όλοι ότι αξίζει", 10],
  ["Να κεράσεις σφηνάκια", 8], ["Να γνωρίσεις κοπέλα, ακόμα και σαν φίλη", 3],
  ["Να σου στείλει κοπέλα", 5], ["Να κάνεις σχόλιο στο TikTok και να σου απαντήσει", 3],
  ["Να μιλάς με κάποια για 1 εβδομάδα", 5]
];
const penalties = [
  ["Όταν τρως άκυρο", -1], ["Όταν σου αρέσει κάποια και δεν πας να της μιλήσεις", -2],
  ["Πας σε κοπέλα που σου είπε ότι άρεσε στον άλλον", -1], ["Όταν δεν σου απαντάει στο μήνυμα", -1],
  ["Λες ψέματα ότι έκανες πρόκληση", -10]
];

function client() {
  const missing = [
    !process.env.SUPABASE_URL && "SUPABASE_URL",
    !process.env.SUPABASE_SERVICE_ROLE_KEY && "SUPABASE_SERVICE_ROLE_KEY"
  ].filter(Boolean);
  if (missing.length) {
    throw new Error(`Missing ${missing.join(" and ")} in Vercel environment variables.`);
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function getState() {
  const supabase = client();
  const [{ data: playerRows, error: playerError }, { data: events, error: eventError }] = await Promise.all([
    supabase.from("players").select("name, avatar_url").order("created_at"),
    supabase.from("point_events").select("player_name, action, points, created_at").order("created_at")
  ]);
  if (playerError || eventError) throw playerError || eventError;

  const scores = Object.fromEntries(players.map(name => [name, 0]));
  const avatars = {};
  playerRows.forEach(player => { scores[player.name] = 0; avatars[player.name] = player.avatar_url; });
  events.forEach(event => { scores[event.player_name] = (scores[event.player_name] || 0) + event.points; });
  return { scores, avatars, history: events.map(event => ({ player: event.player_name, action: event.action, points: event.points })) };
}

module.exports = async function handler(request, response) {
  try {
    if (request.method === "GET") return response.status(200).json(await getState());
    const supabase = client();

    if (request.method === "POST") {
      const { player, type, index } = request.body || {};
      const values = type === "challenge" ? challenges : type === "penalty" ? penalties : null;
      if (!players.includes(player) || !values || !Number.isInteger(index) || index < 0 || index >= values.length) {
        return response.status(400).json({ error: "Μη έγκυρη καταχώρηση." });
      }
      const { error } = await supabase.from("point_events").insert({
        player_name: player,
        action: values[index][0],
        points: values[index][1]
      });
      if (error) throw error;
      return response.status(200).json(await getState());
    }

    if (request.method === "DELETE") {
      if (!process.env.ADMIN_TOKEN || request.headers["x-admin-token"] !== process.env.ADMIN_TOKEN) {
        return response.status(401).json({ error: "Μη εξουσιοδοτημένη ενέργεια." });
      }
      const { error } = await supabase.from("point_events").delete().not("id", "is", null);
      if (error) throw error;
      return response.status(200).json(await getState());
    }

    return response.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    console.error(error);
    const message = error.message && error.message.startsWith("Missing ")
      ? error.message
      : "Ο server δεν είναι διαθέσιμος. Check the Vercel function logs.";
    return response.status(500).json({ error: message });
  }
};