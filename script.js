/**
 * ============================================================================
 * script.js - Vanilla JS Cloud State Management, Rendering & Auth Flow
 * ============================================================================
 * Key features:
 * 1. PURE FIREBASE PERSISTENCE: Zero localStorage usage. All state is backed by Firestore.
 * 2. AUTHENTICATION: Supports Sign-In, Sign-Up, Anonymous Login, and Sign-Out.
 * 3. DATE WHEN ADDED: Every task displays "Added on <Date, Time>".
 * 4. SINGLE UNIFIED LIST: No duplicate completed accordion. Filter tabs (All / Active / Completed)
 *    cleanly control the view, with completed tasks displaying completion timestamp & strikethrough.
 * 5. IMMERSIVE DYNAMIC UI: Glassmorphic cards with responsive layout and animated ambient blobs.
 */

import { 
  initFirebase, 
  loginWithEmail, 
  registerWithEmail, 
  loginAnonymously, 
  logoutUser, 
  syncTaskToFirestore, 
  deleteTaskFromFirestore, 
  deleteMultipleTasksFromFirestore 
} from "./firebase.js";

/* ==========================================================================
   1. Application State
   ========================================================================== */
const state = {
  user: null,              // Authenticated user object or null
  tasks: [],               // Cloud-synced tasks list
  filter: "all",           // 'all' | 'active' | 'completed'
  status: "idle",          // 'idle' | 'syncing' | 'offline'
  editingTaskId: null      // ID of task currently being inline-edited, if any
};

/* ==========================================================================
   2. DOM Elements Cache
   ========================================================================== */
const authContainer = document.getElementById("auth-container");
const todoContainer = document.getElementById("todo-container");
const authForm = document.getElementById("auth-form");
const authEmail = document.getElementById("auth-email");
const authPassword = document.getElementById("auth-password");
const authError = document.getElementById("auth-error");
const authSubmitBtn = document.getElementById("auth-submit-btn");
const authAnonBtn = document.getElementById("auth-anon-btn");
const tabLogin = document.getElementById("tab-login");
const tabRegister = document.getElementById("tab-register");

const userDisplay = document.getElementById("user-display");
const btnLogout = document.getElementById("btn-logout");
const syncStatusEl = document.getElementById("sync-status");

const taskForm = document.getElementById("task-form");
const taskInput = document.getElementById("task-input");
const inputError = document.getElementById("input-error");

const filterButtons = document.querySelectorAll(".filter-btn");
const taskCounterEl = document.getElementById("task-counter");
const clearCompletedBtn = document.getElementById("clear-completed-btn");
const taskListEl = document.getElementById("task-list");
const emptyStateEl = document.getElementById("empty-state");
const toastContainer = document.getElementById("toast-container");

let authMode = "login"; // 'login' | 'register'

/* ==========================================================================
   3. Toast Notifications
   ========================================================================== */
const showToast = (message, type = "normal") => {
  if (!toastContainer) return;
  const toast = document.createElement("div");
  toast.className = `toast ${type === "error" ? "toast-error" : type === "warning" ? "toast-warning" : ""}`;
  toast.textContent = message;

  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 3500);
};

/* ==========================================================================
   4. Date & Time Formatting Helper
   ========================================================================== */
const formatDateTime = (timestamp) => {
  if (!timestamp) return "";
  const d = new Date(timestamp);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });
};

/* ==========================================================================
   5. State-Mutating Functions (Optimistic + Direct Firestore Cloud Sync)
   ========================================================================== */

const addTask = (text) => {
  const trimmed = text.trim();
  if (!trimmed) return;

  const now = Date.now();
  const newTask = {
    id: `task_${now}_${Math.random().toString(36).substring(2, 7)}`,
    text: trimmed,
    completed: false,
    createdAt: now,
    updatedAt: now,
    completedAt: null
  };

  // Optimistic UI update
  state.tasks.unshift(newTask);
  render();

  // Pure cloud sync
  syncTaskToFirestore(newTask).catch((err) => {
    console.warn("Firestore sync failed:", err);
    showToast("Cloud sync failed. Working offline.", "warning");
  });
};

const toggleTask = (taskId) => {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return;

  const now = Date.now();
  task.completed = !task.completed;
  task.updatedAt = now;
  task.completedAt = task.completed ? now : null;

  render();

  syncTaskToFirestore(task).catch((err) => {
    console.warn("Firestore toggle sync failed:", err);
    showToast("Failed to sync change.", "warning");
  });
};

const editTask = (taskId, newText) => {
  const trimmed = newText.trim();
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) {
    state.editingTaskId = null;
    render();
    return;
  }

  if (!trimmed) {
    deleteTask(taskId);
    return;
  }

  if (task.text !== trimmed) {
    task.text = trimmed;
    task.updatedAt = Date.now();

    render();
    syncTaskToFirestore(task).catch((err) => {
      console.warn("Firestore edit sync failed:", err);
      showToast("Edit sync failed.", "warning");
    });
  }

  state.editingTaskId = null;
  render();
};

const deleteTask = (taskId) => {
  const index = state.tasks.findIndex((t) => t.id === taskId);
  if (index === -1) return;

  state.tasks.splice(index, 1);
  if (state.editingTaskId === taskId) {
    state.editingTaskId = null;
  }

  render();
  deleteTaskFromFirestore(taskId).catch((err) => {
    console.warn("Firestore delete failed:", err);
    showToast("Delete sync failed.", "warning");
  });
};

const clearCompleted = () => {
  const completedTasks = state.tasks.filter((t) => t.completed);
  if (completedTasks.length === 0) return;

  const confirmed = window.confirm(`Permanently remove all ${completedTasks.length} completed task(s)?`);
  if (!confirmed) return;

  const completedIds = completedTasks.map((t) => t.id);
  state.tasks = state.tasks.filter((t) => !t.completed);

  render();
  deleteMultipleTasksFromFirestore(completedIds).catch((err) => {
    console.warn("Firestore batch delete failed:", err);
    showToast("Clear completed sync failed.", "warning");
  });
};

const setFilter = (filter) => {
  state.filter = filter;
  render();
};

const setStatus = (status) => {
  state.status = status;
  renderStatus();
};

/* ==========================================================================
   6. DOM Rendering (Safe, XSS-Protected)
   ========================================================================== */

/**
 * Constructs an individual task item.
 * Displays "Added on <Date, Time>" and, if completed, "Completed on <Date, Time>".
 */
const createTaskElement = (task) => {
  const li = document.createElement("li");
  li.className = `task-item ${task.completed ? "completed-item" : ""}`;
  li.dataset.id = task.id;

  const leftDiv = document.createElement("div");
  leftDiv.className = "task-left";

  // Checkbox
  const checkLabel = document.createElement("label");
  checkLabel.className = "checkbox-container";
  checkLabel.setAttribute("aria-label", `Mark "${task.text}" as ${task.completed ? "active" : "complete"}`);

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "task-checkbox";
  checkbox.checked = task.completed;
  checkbox.dataset.id = task.id;

  checkLabel.appendChild(checkbox);
  leftDiv.appendChild(checkLabel);

  // Task Content Container
  const contentDiv = document.createElement("div");
  contentDiv.className = "task-content";

  if (state.editingTaskId === task.id) {
    // Inline editing field
    const editInput = document.createElement("input");
    editInput.type = "text";
    editInput.className = "task-edit-input";
    editInput.value = task.text;
    editInput.dataset.id = task.id;
    contentDiv.appendChild(editInput);
  } else {
    // Text title
    const span = document.createElement("span");
    span.className = "task-text";
    span.textContent = task.text;
    span.dataset.id = task.id;
    span.title = "Double click to edit";
    contentDiv.appendChild(span);

    // Timestamps container: Added on Date + Completed on Date
    const timeContainer = document.createElement("div");
    timeContainer.className = "task-timestamps";

    const addedTime = document.createElement("span");
    addedTime.className = "time-item";
    addedTime.textContent = `📅 Added on ${formatDateTime(task.createdAt)}`;
    timeContainer.appendChild(addedTime);

    if (task.completed && task.completedAt) {
      const completedTime = document.createElement("span");
      completedTime.className = "time-item";
      completedTime.textContent = `✓ Completed on ${formatDateTime(task.completedAt)}`;
      timeContainer.appendChild(completedTime);
    }

    contentDiv.appendChild(timeContainer);
  }

  leftDiv.appendChild(contentDiv);
  li.appendChild(leftDiv);

  // Actions (Edit + Delete)
  const actionsDiv = document.createElement("div");
  actionsDiv.className = "task-actions";

  if (!task.completed) {
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "action-btn btn-edit";
    editBtn.dataset.id = task.id;
    editBtn.setAttribute("aria-label", `Edit "${task.text}"`);
    editBtn.title = "Edit task";
    editBtn.innerHTML = `
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
      </svg>
    `;
    actionsDiv.appendChild(editBtn);
  }

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "action-btn btn-delete";
  deleteBtn.dataset.id = task.id;
  deleteBtn.setAttribute("aria-label", `Delete "${task.text}"`);
  deleteBtn.title = "Delete task";
  deleteBtn.innerHTML = `
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="3 6 5 6 21 6"></polyline>
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
    </svg>
  `;
  actionsDiv.appendChild(deleteBtn);

  li.appendChild(actionsDiv);
  return li;
};

/**
 * Main render function.
 */
const render = () => {
  // If not logged in, show Auth screen
  if (!state.user) {
    authContainer.classList.remove("hidden");
    todoContainer.classList.add("hidden");
    return;
  }

  // User is logged in: show Todo screen
  authContainer.classList.add("hidden");
  todoContainer.classList.remove("hidden");

  if (userDisplay) {
    userDisplay.textContent = state.user.isAnonymous 
      ? "Guest (Anonymous)" 
      : (state.user.email || "User");
  }

  // Filter tasks
  const activeTasks = state.tasks.filter((t) => !t.completed);
  const completedTasks = state.tasks.filter((t) => t.completed);

  let filteredTasks = [];
  if (state.filter === "all") {
    // Show active first, completed below
    filteredTasks = [...activeTasks, ...completedTasks];
  } else if (state.filter === "active") {
    filteredTasks = activeTasks;
  } else if (state.filter === "completed") {
    filteredTasks = completedTasks;
  }

  // Counter
  const count = activeTasks.length;
  taskCounterEl.textContent = `${count} ${count === 1 ? "item" : "items"} left`;

  // Clear completed button
  if (completedTasks.length > 0) {
    clearCompletedBtn.classList.remove("hidden");
  } else {
    clearCompletedBtn.classList.add("hidden");
  }

  // Filter Buttons active state
  filterButtons.forEach((btn) => {
    if (btn.dataset.filter === state.filter) {
      btn.classList.add("active");
      btn.setAttribute("aria-pressed", "true");
    } else {
      btn.classList.remove("active");
      btn.setAttribute("aria-pressed", "false");
    }
  });

  // Render items into task list
  taskListEl.innerHTML = "";
  if (filteredTasks.length === 0) {
    emptyStateEl.classList.remove("hidden");
    const emptyMsg = emptyStateEl.querySelector(".empty-text");
    if (emptyMsg) {
      if (state.filter === "completed") {
        emptyMsg.textContent = "No completed tasks yet. Finish a task to see it here!";
      } else if (state.filter === "active") {
        emptyMsg.textContent = "No active tasks right now. Great job!";
      } else {
        emptyMsg.textContent = "Your task list is empty. Add a task above to begin!";
      }
    }
  } else {
    emptyStateEl.classList.add("hidden");
    const fragment = document.createDocumentFragment();
    filteredTasks.forEach((t) => {
      fragment.appendChild(createTaskElement(t));
    });
    taskListEl.appendChild(fragment);
  }

  // Edit focus
  if (state.editingTaskId) {
    const editInput = taskListEl.querySelector(".task-edit-input");
    if (editInput) {
      editInput.focus();
      const val = editInput.value;
      editInput.value = "";
      editInput.value = val;
    }
  }

  renderStatus();
};

const renderStatus = () => {
  if (!syncStatusEl) return;
  syncStatusEl.className = `sync-badge status-${state.status}`;
  const textSpan = syncStatusEl.querySelector(".status-text");
  if (!textSpan) return;

  switch (state.status) {
    case "idle":
      textSpan.textContent = "Synced";
      break;
    case "syncing":
      textSpan.textContent = "Syncing...";
      break;
    case "offline":
      textSpan.textContent = "Offline";
      break;
    default:
      textSpan.textContent = "Ready";
  }
};

/* ==========================================================================
   7. Event Listeners & Delegation
   ========================================================================== */

// Auth Tab Switching
tabLogin.addEventListener("click", () => {
  authMode = "login";
  tabLogin.classList.add("active");
  tabLogin.setAttribute("aria-selected", "true");
  tabRegister.classList.remove("active");
  tabRegister.setAttribute("aria-selected", "false");
  authSubmitBtn.querySelector("span").textContent = "Sign In";
  authError.classList.add("hidden");
});

tabRegister.addEventListener("click", () => {
  authMode = "register";
  tabRegister.classList.add("active");
  tabRegister.setAttribute("aria-selected", "true");
  tabLogin.classList.remove("active");
  tabLogin.setAttribute("aria-selected", "false");
  authSubmitBtn.querySelector("span").textContent = "Sign Up";
  authError.classList.add("hidden");
});

// Auth Form Submission
authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = authEmail.value.trim();
  const password = authPassword.value;

  if (!email || !password) {
    authError.textContent = "Please enter both email and password.";
    authError.classList.remove("hidden");
    return;
  }

  try {
    authError.classList.add("hidden");
    if (authMode === "login") {
      await loginWithEmail(email, password);
    } else {
      await registerWithEmail(email, password);
    }
  } catch (err) {
    authError.textContent = err.message || "Authentication failed.";
    authError.classList.remove("hidden");
  }
});

// Anonymous Sign In
authAnonBtn.addEventListener("click", async () => {
  try {
    authError.classList.add("hidden");
    await loginAnonymously();
  } catch (err) {
    authError.textContent = err.message || "Failed to continue anonymously.";
    authError.classList.remove("hidden");
  }
});

// Sign Out
btnLogout.addEventListener("click", async () => {
  await logoutUser();
  state.tasks = [];
  render();
});

// Task Input Error Clearing
taskInput.addEventListener("input", () => {
  if (taskInput.value.trim()) {
    inputError.classList.add("hidden");
    taskInput.classList.remove("has-error");
  }
});

// Task Creation
taskForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = taskInput.value.trim();
  if (!text) {
    inputError.textContent = "Please enter a task before adding.";
    inputError.classList.remove("hidden");
    taskInput.classList.add("has-error");
    taskInput.focus();
    return;
  }
  inputError.classList.add("hidden");
  taskInput.classList.remove("has-error");
  addTask(text);
  taskInput.value = "";
  taskInput.focus();
});

// Delegated Clicks on Task List
taskListEl.addEventListener("click", (e) => {
  const checkbox = e.target.closest(".task-checkbox");
  if (checkbox) {
    toggleTask(checkbox.dataset.id);
    return;
  }

  const editBtn = e.target.closest(".btn-edit");
  if (editBtn) {
    state.editingTaskId = editBtn.dataset.id;
    render();
    return;
  }

  const deleteBtn = e.target.closest(".btn-delete");
  if (deleteBtn) {
    deleteTask(deleteBtn.dataset.id);
    return;
  }
});

// Delegated Double-Click for Inline Edit
taskListEl.addEventListener("dblclick", (e) => {
  const textEl = e.target.closest(".task-text");
  if (textEl) {
    state.editingTaskId = textEl.dataset.id;
    render();
  }
});

// Delegated Keyboard Controls on Inline Edit
taskListEl.addEventListener("keydown", (e) => {
  if (e.target.classList.contains("task-edit-input")) {
    const id = e.target.dataset.id;
    if (e.key === "Enter") {
      e.preventDefault();
      editTask(id, e.target.value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      state.editingTaskId = null;
      render();
    }
  }
});

// Delegated Blur/Focusout on Inline Edit
taskListEl.addEventListener("focusout", (e) => {
  if (e.target.classList.contains("task-edit-input")) {
    const id = e.target.dataset.id;
    setTimeout(() => {
      if (state.editingTaskId === id) {
        editTask(id, e.target.value);
      }
    }, 100);
  }
});

// Delegated Filter Button Clicks
const filterGroup = document.getElementById("filter-group");
filterGroup.addEventListener("click", (e) => {
  const btn = e.target.closest(".filter-btn");
  if (btn && btn.dataset.filter) {
    setFilter(btn.dataset.filter);
  }
});

// Clear Completed
clearCompletedBtn.addEventListener("click", () => {
  clearCompleted();
});

/* ==========================================================================
   8. Application Initialization Flow
   ========================================================================== */
const init = async () => {
  // Ensure any legacy localStorage data is completely removed
  try {
    localStorage.removeItem("vanilla_todo_app_state_v1");
  } catch (e) {}

  // Initialize Firebase Authentication & Firestore sync
  await initFirebase(
    (user) => {
      state.user = user;
      render();
    },
    (remoteTasks) => {
      if (Array.isArray(remoteTasks)) {
        state.tasks = remoteTasks;
        render();
      }
    },
    (status) => setStatus(status)
  );

  render();
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
