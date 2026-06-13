import api from "./client.js";

// --- Auth ---
export const authApi = {
  login: (payload) => api.post("/login", payload).then((r) => r.data),
  register: (payload) => api.post("/register", payload).then((r) => r.data),
  me: () => api.get("/me").then((r) => r.data.user),
  updateProfile: (payload) => api.put("/me", payload).then((r) => r.data.user),
  logout: () => api.post("/logout").then((r) => r.data),
};

// --- Curriculum ---
export const curriculumApi = {
  // The signed-in student's scoped tree: { level, path, subjects }.
  mine: () => api.get("/curriculum").then((r) => r.data),
  // Stage → Track → Level options for the cascading selector.
  options: () => api.get("/curriculum/options").then((r) => r.data.stages),
};

// --- Admin: curriculum management (Stage→Track→Level→Subject→Chapter→Topic) ---
const PLURAL = {
  stage: "stages", track: "tracks", level: "levels",
  subject: "subjects", chapter: "chapters", topic: "topics",
};
export const adminCurriculumApi = {
  tree: () => api.get("/admin/curriculum/tree").then((r) => r.data.stages),
  create: (type, payload) => api.post(`/admin/curriculum/${PLURAL[type]}`, payload).then((r) => r.data),
  update: (type, id, payload) => api.patch(`/admin/curriculum/${PLURAL[type]}/${id}`, payload).then((r) => r.data),
  remove: (type, id) => api.delete(`/admin/curriculum/${PLURAL[type]}/${id}`).then((r) => r.data),
};

// --- Student: tutor chat ---
export const tutorApi = {
  sessions: (params) => api.get("/tutor/sessions", { params }).then((r) => r.data.sessions),
  start: (payload) => api.post("/tutor/sessions", payload).then((r) => r.data.session),
  show: (id) => api.get(`/tutor/sessions/${id}`).then((r) => r.data.session),
  send: (id, message) => api.post(`/tutor/sessions/${id}/send`, { message }).then((r) => r.data.message),
  feedback: (messageId, rating) =>
    api.post(`/tutor/messages/${messageId}/feedback`, { rating }).then((r) => r.data),
  // Rename a chat (shown in the session list).
  rename: (id, title) => api.patch(`/tutor/sessions/${id}`, { title }).then((r) => r.data.session),
  // The tutor's live "mind": mastery, misconceptions, memory, next step.
  mind: (id) => api.get(`/tutor/sessions/${id}/mind`).then((r) => r.data.mind),
  // Snap-a-doubt: photo -> OCR text (then send it as a normal message).
  snap: (file) => {
    const form = new FormData();
    form.append("image", file);
    return api.post("/tutor/snap", form, {
      headers: { "Content-Type": "multipart/form-data" },
    }).then((r) => r.data);
  },
};

// --- Student: study notes (uploaded files, kept per topic) ---
export const notesApi = {
  // params: { topic_id?, topic_name }
  list: (params) => api.get("/tutor/notes", { params }).then((r) => r.data),
  upload: (file, ctx, onProgress) => {
    const form = new FormData();
    form.append("file", file);
    if (ctx.topic_id) form.append("topic_id", ctx.topic_id);
    form.append("topic_name", ctx.topic_name || "");
    if (ctx.chapter_name) form.append("chapter_name", ctx.chapter_name);
    if (ctx.subject_name) form.append("subject_name", ctx.subject_name);
    return api.post("/tutor/notes", form, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 200000, // extraction + summarise can take a while
      onUploadProgress: onProgress,
    }).then((r) => r.data.note);
  },
  get: (id) => api.get(`/tutor/notes/${id}`).then((r) => r.data.note),
  remove: (id) => api.delete(`/tutor/notes/${id}`).then((r) => r.data),
};

// --- Student: Day/Week/Month/Exam planner ---
export const plannerApi = {
  // params: { topic_id?, topic_name }
  index: (params) => api.get("/tutor/planner", { params }).then((r) => r.data),
  generate: (payload) =>
    api.post("/tutor/planner/generate", payload, { timeout: 200000 }).then((r) => r.data.plan),
  replan: (planId) =>
    api.post(`/tutor/planner/${planId}/replan`, {}, { timeout: 200000 }).then((r) => r.data.plan),
  toggleTask: (taskId) => api.patch(`/tutor/planner/tasks/${taskId}/toggle`).then((r) => r.data.task),
  archive: (planId) => api.delete(`/tutor/planner/${planId}`).then((r) => r.data),
};

// --- Student: spaced-repetition flashcards ---
export const flashcardsApi = {
  index: (params) => api.get("/tutor/flashcards", { params }).then((r) => r.data),
  due: (params) => api.get("/tutor/flashcards/due", { params }).then((r) => r.data.flashcards),
  review: (cardId, grade) =>
    api.post(`/tutor/flashcards/${cardId}/review`, { grade }).then((r) => r.data.flashcard),
};

// --- Student: Mistake Notebook ---
export const mistakesApi = {
  index: (params) => api.get("/tutor/mistakes", { params }).then((r) => r.data.mistakes),
  resolve: (id) => api.patch(`/tutor/mistakes/${id}/resolve`).then((r) => r.data.mistake),
};

// --- Student: assessment + gaps ---
// Generous per-call timeouts so a hung AI request fails (and shows a retry)
// instead of leaving the modal stuck on "loading"/"Checking…" forever. The
// backend's AI_SERVICE_TIMEOUT is ~180s, so allow a little more than that.
export const assessmentApi = {
  generate: (payload) => api.post("/assessments/generate", payload, { timeout: 200000 }).then((r) => r.data.assessment),
  submit: (id, answers) => api.post(`/assessments/${id}/submit`, { answers }, { timeout: 120000 }).then((r) => r.data),
  history: () => api.get("/assessments/history").then((r) => r.data.assessments),
};

// --- Student: learning plans ---
export const planApi = {
  index: () => api.get("/plans").then((r) => r.data.plans),
  generate: (topic_name) => api.post("/plans/generate", { topic_name }).then((r) => r.data.plan),
  toggleItem: (itemId) => api.patch(`/plans/items/${itemId}/toggle`).then((r) => r.data.item),
};

// --- Student: progress ---
export const progressApi = {
  summary: () => api.get("/progress").then((r) => r.data),
};

// --- AI usage / credits (students see credits, never raw tokens) ---
export const usageApi = {
  me: () => api.get("/usage").then((r) => r.data),
  child: (childId) => api.get(`/parent/children/${childId}/usage`).then((r) => r.data),
};

// --- Parent ---
export const parentApi = {
  children: () => api.get("/parent/children").then((r) => r.data.children),
  report: (childId) => api.get(`/parent/children/${childId}/report`).then((r) => r.data),
  gaps: (childId) => api.get(`/parent/children/${childId}/gaps`).then((r) => r.data),
  linkChild: (child_email, relationship) =>
    api.post("/parent/children/link", { child_email, relationship }).then((r) => r.data),
};

// --- Admin ---
export const adminApi = {
  stats: () => api.get("/admin/stats").then((r) => r.data),
  users: (params) => api.get("/admin/users", { params }).then((r) => r.data.users),
  userDetail: (id) => api.get(`/admin/users/${id}`).then((r) => r.data),
  userProgress: (id) => api.get(`/admin/users/${id}/progress`).then((r) => r.data),
  setActive: (userId, is_active) => api.patch(`/admin/users/${userId}/active`, { is_active }).then((r) => r.data.user),
  updateUser: (userId, payload) => api.patch(`/admin/users/${userId}`, payload).then((r) => r.data.user),
  linkChild: (parentId, childEmail, relationship) =>
    api.post(`/admin/users/${parentId}/link-child`, { child_email: childEmail, relationship }).then((r) => r.data),
  unlinkChild: (parentId, studentId) =>
    api.delete(`/admin/users/${parentId}/unlink-child/${studentId}`).then((r) => r.data),
};

// --- Admin: AI usage & billing (credit control; tokens + ₹ admin-only) ---
export const adminUsageApi = {
  overview: (days = 30) => api.get("/admin/usage", { params: { days } }).then((r) => r.data),
  userLedger: (userId) => api.get(`/admin/users/${userId}/usage`).then((r) => r.data),
  setUserPlan: (userId, plan_key) =>
    api.patch(`/admin/users/${userId}/plan`, { plan_key }).then((r) => r.data),
  grantCredits: (userId, payload) =>
    api.post(`/admin/users/${userId}/grant-credits`, payload).then((r) => r.data),
  plans: () => api.get("/admin/plans").then((r) => r.data),
  updatePlan: (planId, payload) => api.patch(`/admin/plans/${planId}`, payload).then((r) => r.data),
  modelRates: () => api.get("/admin/model-rates").then((r) => r.data),
  addModelRate: (payload) => api.post("/admin/model-rates", payload).then((r) => r.data),
};

// --- Admin: gap analytics ---
export const adminGapApi = {
  overview: (days = 30) => api.get("/admin/gaps", { params: { days } }).then((r) => r.data),
};
