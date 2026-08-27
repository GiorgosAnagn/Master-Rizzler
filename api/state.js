const { createClient } = require("@supabase/supabase-js");

function supabase() {
  const url = String(process.env.SUPABASE_URL || "").trim().replace(/^['"`]|['"`]$/g, "").replace(/\/rest\/v1\/?$/, "").replace(/\/+$/, "");
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim().replace(/^['"`]|['"`]$/g, "");
  if (!url || !key) throw new Error("Supabase environment variables are missing in Vercel.");
  return createClient(url, key);
}

function authClient() {
  const url = String(process.env.SUPABASE_URL || "").trim().replace(/^['"`]|['"`]$/g, "").replace(/\/rest\/v1\/?$/, "").replace(/\/+$/, "");
  const key = String(process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim().replace(/^['"`]|['"`]$/g, "");
  if (!url || !key) throw new Error("Supabase authentication environment variables are missing in Vercel.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function withTimeout(promise, milliseconds, message) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function body(request) {
  if (!request.body) return {};
  return typeof request.body === "string" ? JSON.parse(request.body) : request.body;
}

async function userFromRequest(request, client) {
  const header = request.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

async function profile(client, user) {
  const { data, error } = await client.from("profiles").select("id, display_name, avatar_url").eq("id", user.id).single();
  if (error) throw error;
  return data;
}

async function membership(client, groupId, userId, activeOnly = true) {
  let query = client.from("group_members").select("group_id, user_id, role, status").eq("group_id", groupId).eq("user_id", userId);
  if (activeOnly) query = query.eq("status", "active");
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data;
}

async function groupState(client, groupId, user) {
  const member = await membership(client, groupId, user.id);
  if (!member) throw Object.assign(new Error("You are not an active member of this group."), { status: 403 });
  const [{ data: group, error: groupError }, { data: members, error: membersError }, { data: tasks, error: tasksError }, { data: events, error: eventsError }] = await Promise.all([
    client.from("groups").select("id, name, code, owner_id").eq("id", groupId).single(),
    client.from("group_members").select("user_id, role, status").eq("group_id", groupId),
    client.from("group_tasks").select("id, description, points").eq("group_id", groupId).order("created_at"),
    client.from("point_events").select("id, player_id, task_id, action, points, created_at").eq("group_id", groupId).order("created_at")
  ]);
  if (groupError || membersError || tasksError || eventsError) throw groupError || membersError || tasksError || eventsError;
  const profileIds = [...new Set([...members.map(item => item.user_id), ...events.map(item => item.player_id)])];
  const { data: profiles, error: profilesError } = await client.from("profiles").select("id, display_name, avatar_url").in("id", profileIds);
  if (profilesError) throw profilesError;
  const profileMap = Object.fromEntries(profiles.map(item => [item.id, item]));
  members.forEach(item => { item.profiles = profileMap[item.user_id] || { id: item.user_id, display_name: "Player", avatar_url: null }; });
  const scores = Object.fromEntries(members.filter(item => item.status === "active").map(item => [item.user_id, 0]));
  events.forEach(event => { scores[event.player_id] = (scores[event.player_id] || 0) + event.points; });
  return { group, currentUser: member, members, tasks, scores, history: events.map(event => ({ id: event.id, player: profileMap[event.player_id]?.display_name || "Player", action: event.action, points: event.points, created_at: event.created_at })) };
}

function fail(response, status, message) { return response.status(status).json({ error: message }); }

module.exports = async function handler(request, response) {
  const client = supabase();
  try {
    const input = body(request);
    if (request.method === "GET" && request.query?.action === "config") {
      const url = String(process.env.SUPABASE_URL || "").trim().replace(/^['"`]|['"`]$/g, "").replace(/\/rest\/v1\/?$/, "").replace(/\/+$/, "");
      const anonKey = String(process.env.SUPABASE_ANON_KEY || "").trim().replace(/^['"`]|['"`]$/g, "");
      if (!url || !anonKey) return fail(response, 500, "Supabase public authentication key is missing in Vercel.");
      return response.status(200).json({ url, anonKey });
    }
    if (request.method === "POST" && request.query?.action === "auth") {
      const { mode, email, password, displayName } = input;
      if (mode === "reset") {
        if (!email) return fail(response, 400, "Enter your email address first.");
        const auth = authClient();
        const redirectTo = String(input.redirectTo || "");
        const result = await withTimeout(
          auth.auth.resetPasswordForEmail(email, redirectTo ? { redirectTo } : undefined),
          10000,
          "Supabase password reset timed out."
        );
        if (result.error) return fail(response, 400, result.error.message);
        return response.status(200).json({ message: "If that email exists, a reset link has been sent." });
      }
      if (!email || !password) return fail(response, 400, "Email and password are required.");
      const auth = authClient();
      const result = await withTimeout(
        mode === "register"
          ? auth.auth.signUp({ email, password, options: { data: { display_name: String(displayName || "Player").trim() } } })
          : auth.auth.signInWithPassword({ email, password }),
        10000,
        "Supabase authentication timed out. Check the Supabase URL and auth key in Vercel."
      );
      if (result.error) return fail(response, 401, result.error.message);
      if (mode === "register" && result.data.user && displayName) await client.from("profiles").update({ display_name: String(displayName).trim() }).eq("id", result.data.user.id);
      return response.status(200).json({ session: result.data.session, user: result.data.user });
    }

    const user = await userFromRequest(request, client);
    if (!user) return fail(response, 401, "Please sign in first.");

    if (request.method === "GET") {
      const requestedGroup = String(request.query?.groupId || "");
      const { data: memberships, error } = await client.from("group_members").select("group_id, role, status, groups(id, name, code, owner_id)").eq("user_id", user.id);
      if (error) throw error;
      if (!requestedGroup) return response.status(200).json({ user: await profile(client, user), groups: memberships });
      return response.status(200).json(await groupState(client, requestedGroup, user));
    }

    if (request.method === "POST" && request.query?.action === "create-group") {
      const name = String(input.name || "My Rizzler Group").trim();
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const { data: group, error } = await client.from("groups").insert({ name, code, owner_id: user.id }).select().single();
      if (error) throw error;
      const { error: memberError } = await client.from("group_members").insert({ group_id: group.id, user_id: user.id, role: "owner", status: "active" });
      if (memberError) throw memberError;
      return response.status(200).json(await groupState(client, group.id, user));
    }

    if (request.method === "POST" && request.query?.action === "join-group") {
      const code = String(input.code || "").replace(/\D/g, "").slice(0, 6);
      const { data: group, error } = await client.from("groups").select("id").eq("code", code).single();
      if (error || !group) return fail(response, 404, "Group code not found.");
      const existing = await membership(client, group.id, user.id, false);
      if (existing?.status === "active") return fail(response, 409, "You are already a member of this group.");
      const { error: joinError } = await client.from("group_members").upsert({ group_id: group.id, user_id: user.id, role: "member", status: "pending", invited_by: user.id }, { onConflict: "group_id,user_id" });
      if (joinError) throw joinError;
      return response.status(200).json({ message: "Join request sent to the group admins." });
    }

    if (request.method === "DELETE" && request.query?.action === "leave-group") {
      const existing = await membership(client, input.groupId, user.id, false);
      if (!existing || existing.status !== "active") return fail(response, 404, "You are not an active member of this group.");
      if (existing.role === "owner") return fail(response, 400, "The group owner must delete the group or transfer ownership before leaving.");
      const { error } = await client.from("group_members").delete().eq("group_id", input.groupId).eq("user_id", user.id);
      if (error) throw error;
      return response.status(200).json({ message: "You left the group." });
    }

    if (request.method === "DELETE" && request.query?.action === "delete-group") {
      const existing = await membership(client, input.groupId, user.id, false);
      if (!existing || existing.role !== "owner" || existing.status !== "active") return fail(response, 403, "Only the group owner can delete this group.");
      const { error } = await client.from("groups").delete().eq("id", input.groupId).eq("owner_id", user.id);
      if (error) throw error;
      return response.status(200).json({ message: "Group deleted." });
    }

    if (request.method === "POST" && request.query?.action === "update-profile") {
      const displayName = String(input.displayName || "").trim();
      const avatarUrl = String(input.avatarUrl || "").trim() || null;
      if (!displayName || displayName.length > 40) return fail(response, 400, "Display name must be 1 to 40 characters.");
      if (avatarUrl && !/^https?:\/\//i.test(avatarUrl)) return fail(response, 400, "Profile picture must be an http(s) URL.");
      const { error } = await client.from("profiles").update({ display_name: displayName, avatar_url: avatarUrl }).eq("id", user.id);
      if (error) throw error;
      return response.status(200).json({ user: await profile(client, user) });
    }

    const groupId = String(input.groupId || request.query?.groupId || "");
    const me = await membership(client, groupId, user.id, false);
    if (!me || (me.status !== "active" && request.query?.action !== "accept-member")) return fail(response, 403, "You do not have access to this group.");

    if (request.method === "POST" && request.query?.action === "accept-member") {
      if (!['owner', 'admin'].includes(me.role)) return fail(response, 403, "Only group admins can accept members.");
      const { userId } = input;
      const { error } = await client.from("group_members").update({ status: "active" }).eq("group_id", groupId).eq("user_id", userId).eq("status", "pending");
      if (error) throw error;
      return response.status(200).json(await groupState(client, groupId, user));
    }

    if (request.method === "POST" && request.query?.action === "add-task") {
      if (!['owner', 'admin'].includes(me.role)) return fail(response, 403, "Only group admins can manage tasks.");
      const description = String(input.description || "").trim();
      const points = Number(input.points);
      if (!description || !Number.isInteger(points) || points === 0 || points < -1000 || points > 1000) return fail(response, 400, "Enter a description and a non-zero point value.");
      const { error } = await client.from("group_tasks").insert({ group_id: groupId, description, points, created_by: user.id });
      if (error) throw error;
      return response.status(200).json(await groupState(client, groupId, user));
    }

    if (request.method === "PATCH" && request.query?.action === "edit-task") {
      if (!['owner', 'admin'].includes(me.role)) return fail(response, 403, "Only group admins can manage tasks.");
      const description = String(input.description || "").trim();
      const points = Number(input.points);
      if (!description || !Number.isInteger(points) || points === 0 || points < -1000 || points > 1000) return fail(response, 400, "Enter a description and a non-zero point value.");
      const { error } = await client.from("group_tasks").update({ description, points }).eq("id", input.taskId).eq("group_id", groupId);
      if (error) throw error;
      return response.status(200).json(await groupState(client, groupId, user));
    }

    if (request.method === "DELETE" && request.query?.action === "delete-task") {
      if (!['owner', 'admin'].includes(me.role)) return fail(response, 403, "Only group admins can manage tasks.");
      const { error } = await client.from("group_tasks").delete().eq("id", input.taskId).eq("group_id", groupId);
      if (error) throw error;
      return response.status(200).json(await groupState(client, groupId, user));
    }

    if (request.method === "POST" && request.query?.action === "set-role") {
      if (me.role !== "owner") return fail(response, 403, "Only the group owner can assign admins.");
      const role = input.role === "admin" ? "admin" : "member";
      const { error } = await client.from("group_members").update({ role }).eq("group_id", groupId).eq("user_id", input.userId).eq("status", "active");
      if (error) throw error;
      return response.status(200).json(await groupState(client, groupId, user));
    }

    if (request.method === "DELETE" && request.query?.action === "remove-member") {
      if (!['owner', 'admin'].includes(me.role)) return fail(response, 403, "Only group admins can remove members.");
      if (input.userId === user.id) return fail(response, 400, "You cannot remove yourself from the group.");
      const target = await membership(client, groupId, input.userId, false);
      if (!target || target.role === "owner") return fail(response, 400, "That member cannot be removed.");
      const { error } = await client.from("group_members").delete().eq("group_id", groupId).eq("user_id", input.userId);
      if (error) throw error;
      return response.status(200).json(await groupState(client, groupId, user));
    }

    if (request.method === "DELETE" && request.query?.action === "delete-event") {
      if (!['owner', 'admin'].includes(me.role)) return fail(response, 403, "Only group admins can delete history entries.");
      const { data: event, error: eventError } = await client.from("point_events").select("id").eq("id", input.eventId).eq("group_id", groupId).maybeSingle();
      if (eventError) throw eventError;
      if (!event) return fail(response, 404, "History entry not found.");
      const { error } = await client.from("point_events").delete().eq("id", input.eventId).eq("group_id", groupId);
      if (error) throw error;
      return response.status(200).json(await groupState(client, groupId, user));
    }

    if (request.method === "POST" && request.query?.action === "add-points") {
      const { playerId, taskId } = input;
      const recipient = await membership(client, groupId, playerId);
      if (!recipient) return fail(response, 400, "That player is not an active member of this group.");
      if (me.role === "member" && playerId !== user.id) return fail(response, 403, "Members can only add points to themselves.");
      const { data: task, error: taskError } = await client.from("group_tasks").select("description, points").eq("id", taskId).eq("group_id", groupId).single();
      if (taskError || !task) return fail(response, 404, "Task not found.");
      const { error } = await client.from("point_events").insert({ group_id: groupId, player_id: playerId, task_id: taskId, action: task.description, points: task.points, created_by: user.id });
      if (error) throw error;
      return response.status(200).json(await groupState(client, groupId, user));
    }

    return fail(response, 405, "Method not allowed.");
  } catch (error) {
    console.error(error);
    return fail(response, error.status || 500, error.message || "Server error.");
  }
};
