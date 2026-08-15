const fs = require("fs");
const path = require("path");

const input = process.argv[2];
const output = process.argv[3];
if (!input || !output) {
  throw new Error("用法: node tools/flatten_leisu_export.js <input.json> <output.tsv>");
}

const root = JSON.parse(fs.readFileSync(input, "utf8"));
const rows = ["JSON路径\t类型\t值"];

function quotePathKey(key) {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
}

function scalar(value) {
  if (value === null) return ["null", "null"];
  if (typeof value === "string") return ["string", JSON.stringify(value)];
  if (typeof value === "number") return ["number", String(value)];
  if (typeof value === "boolean") return ["boolean", String(value)];
  return [typeof value, JSON.stringify(value)];
}

function walk(value, currentPath) {
  if (Array.isArray(value)) {
    if (value.length === 0) rows.push(`${currentPath}\tarray\t[]`);
    value.forEach((item, index) => walk(item, `${currentPath}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) rows.push(`${currentPath}\tobject\t{}`);
    for (const [key, item] of entries) walk(item, currentPath + quotePathKey(key));
    return;
  }
  const [type, text] = scalar(value);
  rows.push(`${currentPath}\t${type}\t${text}`);
}

walk(root, "$" );
fs.writeFileSync(output, rows.join("\r\n") + "\r\n", "utf8");
const stat = fs.statSync(output);
process.stdout.write(JSON.stringify({ input: path.resolve(input), output: path.resolve(output), rows: rows.length - 1, bytes: stat.size }, null, 2));
