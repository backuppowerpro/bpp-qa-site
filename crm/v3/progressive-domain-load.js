// Small, dependency-free progressive-load coordinator for the CRM data layer.
// It keeps domain truth separate from the arrays that hold domain data, so an
// array can never be interpreted as a verified empty result while its read is
// still loading or has failed.

const DOMAIN_STATES = new Set(['idle', 'loading', 'ready', 'error'])

export function createDomainStatusMap(names) {
  return Object.fromEntries((names || []).map(name => [name, {
    state: 'idle',
    error: null,
    attempts: 0,
    startedAt: null,
    settledAt: null,
  }]))
}

function updateStatus(statuses, name, patch, onStatus) {
  const current = statuses[name] || {
    state: 'idle', error: null, attempts: 0, startedAt: null, settledAt: null,
  }
  const nextState = patch.state || current.state
  if (!DOMAIN_STATES.has(nextState)) throw new Error(`Unknown domain state: ${nextState}`)
  Object.assign(current, patch, { state: nextState })
  statuses[name] = current
  if (typeof onStatus === 'function') onStatus(name, current)
}

function errorText(error) {
  if (!error) return null
  return String(error.message || error)
}

function delay(ms) {
  return ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve()
}

async function attemptWithTimeout(task, timeoutMs, label) {
  let timer = null
  const timeout = new Promise(resolve => {
    timer = setTimeout(() => resolve({
      data: null,
      error: { message: `${label} timed out after ${timeoutMs}ms`, timedOut: true },
    }), timeoutMs)
  })
  try {
    return await Promise.race([
      Promise.resolve().then(task).catch(error => ({ data: null, error })),
      timeout,
    ])
  } finally {
    if (timer !== null) clearTimeout(timer)
  }
}

async function runBoundedTask(task, options) {
  const maxAttempts = Math.max(1, Number(options.maxAttempts) || 1)
  let result = null
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    result = await options.schedule(() => attemptWithTimeout(task, options.timeoutMs, options.label))
    if (!result || !result.error) return { ...(result || { data: null, error: null }), attempts: attempt }
    // A timed-out Supabase request cannot be safely cancelled from this generic
    // coordinator. Do not start an overlapping retry while that request may still
    // be alive on the database. Ordinary rejected reads still get the configured
    // bounded retry below.
    if (result.error.timedOut) return { ...result, attempts: attempt }
    if (attempt < maxAttempts) await delay(options.retryDelayMs)
  }
  return { ...(result || { data: null, error: { message: `${options.label} failed` } }), attempts: maxAttempts }
}

async function settleDomain(name, definition, options) {
  const tasks = definition && definition.tasks ? definition.tasks : {}
  const taskEntries = Object.entries(tasks)
  updateStatus(options.statuses, name, {
    state: 'loading',
    error: null,
    attempts: 0,
    startedAt: Date.now(),
    settledAt: null,
  }, options.onStatus)

  const settledTasks = new Array(taskEntries.length)
  const concurrency = Math.max(1, Math.min(
    taskEntries.length || 1,
    Number(definition && definition.taskConcurrency) || taskEntries.length || 1,
  ))
  let nextIndex = 0
  async function worker() {
    while (nextIndex < taskEntries.length) {
      const index = nextIndex
      nextIndex += 1
      const [taskName, task] = taskEntries[index]
      const result = await runBoundedTask(task, {
        label: `${name}.${taskName}`,
        timeoutMs: options.timeoutMs,
        maxAttempts: options.maxAttempts,
        retryDelayMs: options.retryDelayMs,
        schedule: options.schedule,
      })
      settledTasks[index] = [taskName, result]
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()))
  const results = Object.fromEntries(settledTasks)
  const failures = settledTasks.filter(([, result]) => result && result.error)
  const attempts = settledTasks.reduce((max, [, result]) => Math.max(max, Number(result && result.attempts) || 0), 0)
  const error = failures.length > 0
    ? failures.map(([taskName, result]) => `${taskName}: ${errorText(result.error)}`).join('; ')
    : null
  const domainResult = { name, ok: failures.length === 0, results, error }

  updateStatus(options.statuses, name, {
    state: domainResult.ok ? 'ready' : 'error',
    error,
    attempts,
    settledAt: Date.now(),
  }, options.onStatus)
  if (typeof options.onSettled === 'function') options.onSettled(name, domainResult)
  return domainResult
}

function summarize(names, domainResults) {
  const domains = Object.fromEntries(names.map((name, index) => [name, domainResults[index]]))
  return {
    ok: domainResults.every(result => result && result.ok),
    domains,
  }
}

export function startProgressiveDomains({
  domains,
  criticalNames,
  statuses,
  onStatus,
  onSettled,
  timeoutMs = 4_000,
  maxAttempts = 2,
  retryDelayMs = 150,
  taskConcurrency = Number.POSITIVE_INFINITY,
}) {
  const definitions = domains || {}
  const names = Object.keys(definitions)
  const critical = new Set(criticalNames || [])
  const statusMap = statuses || createDomainStatusMap(names)
  const limit = Number.isFinite(Number(taskConcurrency))
    ? Math.max(1, Number(taskConcurrency))
    : Number.POSITIVE_INFINITY
  let activeTasks = 0
  const queuedTasks = []
  const drainTasks = () => {
    while (activeTasks < limit && queuedTasks.length > 0) {
      const queued = queuedTasks.shift()
      activeTasks += 1
      Promise.resolve().then(queued.run).then(queued.resolve, queued.reject).finally(() => {
        activeTasks -= 1
        drainTasks()
      })
    }
  }
  const schedule = limit === Number.POSITIVE_INFINITY
    ? run => Promise.resolve().then(run)
    : run => new Promise((resolve, reject) => {
        queuedTasks.push({ run, resolve, reject })
        drainTasks()
      })
  const running = Object.fromEntries(names.map(name => [
    name,
    settleDomain(name, definitions[name], {
      statuses: statusMap,
      onStatus,
      onSettled,
      timeoutMs,
      maxAttempts,
      retryDelayMs,
      schedule,
    }),
  ]))
  const criticalList = names.filter(name => critical.has(name))
  const backgroundList = names.filter(name => !critical.has(name))

  return {
    domains: running,
    statuses: statusMap,
    critical: Promise.all(criticalList.map(name => running[name]))
      .then(results => summarize(criticalList, results)),
    background: Promise.all(backgroundList.map(name => running[name]))
      .then(results => summarize(backgroundList, results)),
  }
}
