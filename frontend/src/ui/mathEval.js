/**
 * Tiny, safe single-variable math expression evaluator.
 *
 * NO eval / Function constructor — the tutor's output is untrusted, so we
 * tokenize → shunting-yard → evaluate RPN by hand. Supports:
 *   - variable `x`
 *   - numbers (incl. 1.5, .5, 1e3)
 *   - operators + - * / ^ (^ right-assoc) and unary minus
 *   - implicit multiplication: 2x, 2sin(x), 3(x+1), (x+1)(x-1)
 *   - constants: pi, π, e
 *   - unary functions: sin cos tan asin acos atan sinh cosh tanh
 *                      sqrt cbrt abs exp ln log log2 floor ceil round sign
 * Trig is in radians. Returns NaN for malformed input or out-of-domain points
 * (callers skip NaN samples), and compile() throws on a structurally invalid
 * expression so the UI can fall back gracefully.
 */

const FUNCS = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs,
  exp: Math.exp, ln: Math.log, log: Math.log10, log2: Math.log2,
  floor: Math.floor, ceil: Math.ceil, round: Math.round, sign: Math.sign,
};
const CONSTS = { pi: Math.PI, "π": Math.PI, e: Math.E };
const OPS = {
  "+": { prec: 2, assoc: "L" },
  "-": { prec: 2, assoc: "L" },
  "*": { prec: 3, assoc: "L" },
  "/": { prec: 3, assoc: "L" },
  "^": { prec: 4, assoc: "R" },
};

function tokenize(src) {
  const tokens = [];
  const s = String(src).replace(/\s+/g, "");
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if ((c >= "0" && c <= "9") || c === ".") {
      let j = i + 1;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      // scientific notation: 1e3, 2.5e-4
      if (s[j] === "e" || s[j] === "E") {
        j++;
        if (s[j] === "+" || s[j] === "-") j++;
        while (j < s.length && /[0-9]/.test(s[j])) j++;
      }
      tokens.push({ t: "num", v: parseFloat(s.slice(i, j)) });
      i = j;
      continue;
    }
    if (/[a-zA-Zπ]/.test(c)) {
      let j = i + 1;
      while (j < s.length && /[a-zA-Z0-9π]/.test(s[j])) j++;
      const name = s.slice(i, j);
      if (Object.prototype.hasOwnProperty.call(FUNCS, name)) tokens.push({ t: "func", v: name });
      else if (Object.prototype.hasOwnProperty.call(CONSTS, name)) tokens.push({ t: "num", v: CONSTS[name] });
      else if (name === "x" || name === "X") tokens.push({ t: "var" });
      else throw new Error(`unknown symbol "${name}"`);
      i = j;
      continue;
    }
    if (c === "(" || c === ")") { tokens.push({ t: c }); i++; continue; }
    if (Object.prototype.hasOwnProperty.call(OPS, c)) { tokens.push({ t: "op", v: c }); i++; continue; }
    throw new Error(`unexpected character "${c}"`);
  }
  return tokens;
}

// Insert explicit "*" for implicit multiplication and mark unary minus as "u-".
function normalize(tokens) {
  const out = [];
  for (let k = 0; k < tokens.length; k++) {
    const tok = tokens[k];
    const prev = out[out.length - 1];

    if (tok.t === "op" && tok.v === "-") {
      const unary = !prev || prev.t === "op" || prev.t === "(" || prev.t === "u-";
      out.push(unary ? { t: "u-" } : tok);
      continue;
    }
    // implicit multiplication between a value-ending token and a value-starting one
    const valueStart = tok.t === "num" || tok.t === "var" || tok.t === "func" || tok.t === "(";
    const valueEnd = prev && (prev.t === "num" || prev.t === "var" || prev.t === ")");
    if (valueEnd && valueStart) out.push({ t: "op", v: "*" });
    out.push(tok);
  }
  return out;
}

// Unary minus binds tighter than * and / but LOOSER than ^, so that
// -x^2 = -(x^2) and 2^-3 = 2^(-3), matching standard math convention.
const U_MINUS = { prec: 3.5, assoc: "R" };
const opInfo = (tok) => (tok.t === "u-" ? U_MINUS : OPS[tok.v]);

function toRPN(tokens) {
  const output = [];
  const stack = [];
  for (const tok of tokens) {
    if (tok.t === "num" || tok.t === "var") output.push(tok);
    else if (tok.t === "func") stack.push(tok);
    else if (tok.t === "u-") {
      // Prefix operator: it begins a new operand, so it must NOT pop a binary
      // operator that is still waiting for its right-hand side (e.g. in 2^-3
      // the '-' belongs to the exponent). Push directly; its low-vs-^ ranking
      // is enforced when a LATER binary operator meets this u- on the stack.
      stack.push(tok);
    } else if (tok.t === "op") {
      const o1 = opInfo(tok);
      while (stack.length) {
        const top = stack[stack.length - 1];
        if (top.t === "func") { output.push(stack.pop()); continue; }
        if (top.t === "op" || top.t === "u-") {
          const o2 = opInfo(top);
          if (o2.prec > o1.prec || (o2.prec === o1.prec && o1.assoc === "L")) {
            output.push(stack.pop());
            continue;
          }
        }
        break;
      }
      stack.push(tok);
    } else if (tok.t === "(") stack.push(tok);
    else if (tok.t === ")") {
      while (stack.length && stack[stack.length - 1].t !== "(") output.push(stack.pop());
      if (!stack.length) throw new Error("mismatched parenthesis");
      stack.pop(); // discard "("
      if (stack.length && stack[stack.length - 1].t === "func") output.push(stack.pop());
    }
  }
  while (stack.length) {
    const top = stack.pop();
    if (top.t === "(" || top.t === ")") throw new Error("mismatched parenthesis");
    output.push(top);
  }
  return output;
}

function evalRPN(rpn, x) {
  const st = [];
  for (const tok of rpn) {
    if (tok.t === "num") st.push(tok.v);
    else if (tok.t === "var") st.push(x);
    else if (tok.t === "u-") st.push(-st.pop());
    else if (tok.t === "func") st.push(FUNCS[tok.v](st.pop()));
    else if (tok.t === "op") {
      const b = st.pop(), a = st.pop();
      switch (tok.v) {
        case "+": st.push(a + b); break;
        case "-": st.push(a - b); break;
        case "*": st.push(a * b); break;
        case "/": st.push(a / b); break;
        case "^": st.push(Math.pow(a, b)); break;
        default: throw new Error(`bad op ${tok.v}`);
      }
    }
  }
  if (st.length !== 1) throw new Error("invalid expression");
  return st[0];
}

/**
 * Compile an expression string into `(x) => number`. Throws on structurally
 * invalid input (validated once by evaluating at x=1). The returned function
 * itself never throws — it returns NaN for out-of-domain x (e.g. sqrt(-1)).
 */
export function compile(expr) {
  const rpn = toRPN(normalize(tokenize(expr)));
  const fn = (x) => {
    try {
      const y = evalRPN(rpn, x);
      return Number.isFinite(y) ? y : NaN;
    } catch {
      return NaN;
    }
  };
  if (Number.isNaN(fn(1)) && Number.isNaN(fn(0.37)) && Number.isNaN(fn(-0.91))) {
    // structurally fine but never numeric — surface as an error to the caller
    throw new Error("expression did not evaluate to a number");
  }
  return fn;
}

/**
 * Sample y=f(x) across [min,max]. Returns {points, error}. Splits the line at
 * NaN/±Inf and large discontinuities (handled by the chart via null gaps).
 */
export function sample(expr, min, max, steps = 240) {
  let fn;
  try {
    fn = compile(expr);
  } catch (e) {
    return { points: [], error: e.message || "invalid expression" };
  }
  const lo = Number(min), hi = Number(max);
  const a = Number.isFinite(lo) ? lo : -10;
  const b = Number.isFinite(hi) && hi > a ? hi : a + 20;
  const n = Math.max(20, Math.min(1000, steps | 0));
  const dx = (b - a) / n;
  const points = [];
  let prevY = null;
  for (let i = 0; i <= n; i++) {
    const x = a + i * dx;
    let y = fn(x);
    if (!Number.isFinite(y)) y = null;
    // break the curve across asymptotic jumps (e.g. tan) so lines don't streak
    if (y !== null && prevY !== null && Math.abs(y - prevY) > 1e6) {
      points.push({ x: round(x), y: null });
    }
    points.push({ x: round(x), y: y === null ? null : round(y) });
    prevY = y;
  }
  return { points, error: null };
}

const round = (v) => Math.round(v * 1e6) / 1e6;

export default { compile, sample };
