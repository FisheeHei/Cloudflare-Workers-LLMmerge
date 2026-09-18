const STREAM_FAILURES = new Set(["error", "eof", "finish_grace"]);

export function createGatewayTrace({ id = "", protocol = "", model = "" } = {}) {
  return {
    trace_id: String(id || ""),
    protocol: String(protocol || ""),
    model: String(model || ""),
    started_at: Date.now(),
    stage: "received",
    stage_ms: 0,
    stages: { received: 0 },
    attempts: [],
  };
}

export function markGatewayTrace(trace, stage, details = {}) {
  if (!trace) return trace;
  const now = Date.now();
  const name = String(stage || "unknown");
  trace.stage = name;
  trace.stage_ms = Math.max(0, now - Number(trace.started_at || now));
  trace.stages[name] = trace.stage_ms;
  if (details.dispatch_mode) trace.dispatch_mode = String(details.dispatch_mode);
  if (details.failure_reason) trace.failure_reason = String(details.failure_reason);
  if (details.failover_used != null) trace.failover_used = trace.failover_used === true || details.failover_used === true;
  const attemptNumber = Number(details.attempt || 0);
  if (attemptNumber > 0) {
    const attempt = trace.attempts[attemptNumber - 1] || (trace.attempts[attemptNumber - 1] = { attempt: attemptNumber });
    attempt.stage = name;
    attempt.stage_ms = trace.stage_ms;
    if (details.upstream) attempt.upstream = String(details.upstream);
    if (details.status != null) attempt.status = Number(details.status) || 0;
    if (details.dispatch_mode) attempt.dispatch_mode = String(details.dispatch_mode);
    if (details.failure_reason) attempt.failure_reason = String(details.failure_reason);
  }
  return trace;
}

export function gatewayTraceFields(trace) {
  if (!trace) return {};
  if (!trace.stages && (trace.trace_stage || trace.trace_id || trace.trace_route_ms != null)) {
    return {
      trace_id: String(trace.trace_id || ""),
      trace_stage: String(trace.trace_stage || ""),
      trace_stage_ms: Number(trace.trace_stage_ms || 0),
      trace_route_ms: Number(trace.trace_route_ms || 0),
      trace_upstream_start_ms: Number(trace.trace_upstream_start_ms || 0),
      trace_upstream_headers_ms: Number(trace.trace_upstream_headers_ms || 0),
      trace_upstream_called: trace.trace_upstream_called === true,
      trace_upstream_headers: trace.trace_upstream_headers === true,
      trace_attempts: Number(trace.trace_attempts || 0),
      trace_first_visible_ms: Number(trace.trace_first_visible_ms || 0),
      trace_dispatch_mode: String(trace.trace_dispatch_mode || ""),
      trace_failure_reason: String(trace.trace_failure_reason || ""),
      trace_failover_used: trace.trace_failover_used === true,
    };
  }
  const hasStage = (name) => Object.prototype.hasOwnProperty.call(trace.stages || {}, name);
  return {
    trace_id: String(trace.trace_id || ""),
    trace_stage: trace.stage || "",
    trace_stage_ms: Number(trace.stage_ms || 0),
    trace_route_ms: Number(trace.stages?.route_selected || 0),
    trace_upstream_start_ms: Number(trace.stages?.upstream_fetch_called || 0),
    trace_upstream_headers_ms: Number(trace.stages?.upstream_headers_received || 0),
    trace_upstream_called: hasStage("upstream_fetch_called"),
    trace_upstream_headers: hasStage("upstream_headers_received"),
    trace_attempts: Array.isArray(trace.attempts) ? trace.attempts.length : 0,
    trace_first_visible_ms: Number(trace.stages?.first_visible_output || 0),
    trace_dispatch_mode: String(trace.dispatch_mode || ""),
    trace_failure_reason: String(trace.failure_reason || ""),
    trace_failover_used: trace.failover_used === true,
  };
}

export function gatewayTraceLogFields(trace, fallbackTraceId = "") {
  const fields = gatewayTraceFields(trace);
  return {
    ...fields,
    trace_id: String(fallbackTraceId || fields.trace_id || ""),
  };
}

export function gatewayErrorLogFields(error, fallbackTraceId = "") {
  const message = String(error?.message || error || "").trim().slice(0, 240);
  return {
    ...(error?.gatewayTrace ? gatewayTraceLogFields(error.gatewayTrace, fallbackTraceId) : { trace_id: String(fallbackTraceId || "") }),
    dispatch_limited: error?.dispatchLimited === true,
    ...(error?.failureReason ? { failure_reason: String(error.failureReason) } : {}),
    ...(message ? { error_message: message } : {}),
  };
}

export function classifyGatewayFailure({ status = 0, closeReason = "", dispatchLimited = false, errorMessage = "" } = {}) {
  const code = Number(status) || 0;
  const close = String(closeReason || "").toLowerCase();
  const message = String(errorMessage || "").toLowerCase();

  if (code >= 200 && code < 400 && !STREAM_FAILURES.has(close)) return "ok";
  if (dispatchLimited) return "dispatch_busy";
  if (code === 499 || close === "client_abort" || close === "cancelled") return "client_cancelled";
  if (code === 401 || code === 403) return "auth_or_permission";
  if (code === 404) return "model_or_route_not_found";
  if (message.includes("first byte") || message.includes("first visible")) return "upstream_first_byte_timeout";
  if (code === 408 || code === 504 || message.includes("timeout")) return "upstream_timeout";
  if (code === 429) return "upstream_rate_limit";
  if (close === "eof") return "upstream_stream_eof";
  if (STREAM_FAILURES.has(close)) return "stream_finalize_error";
  if (code === 502 || code === 503 || code === 524 || code === 529) return "upstream_unavailable";
  if (code >= 500) return "gateway_or_upstream_error";
  if (code >= 400) return "request_rejected";
  return message ? "upstream_error" : "unknown";
}
