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
};

// --- Student: assessment + gaps ---
export const assessmentApi = {
  generate: (payload) => api.post("/assessments/generate", payload).then((r) => r.data.assessment),
  submit: (id, answers) => api.post(`/assessments/${id}/submit`, { answers }).then((r) => r.data),
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

// --- Parent ---
export const parentApi = {
  children: () => api.get("/parent/children").then((r) => r.data.children),
  report: (childId) => api.get(`/parent/children/${childId}/report`).then((r) => r.data),
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
