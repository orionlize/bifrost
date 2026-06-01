import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const enDir = path.join(__dirname, "../lib/i18n/locales/en");
const zhDir = path.join(__dirname, "../lib/i18n/locales/zh");

function propertyName(prop) {
	if (ts.isPropertyAssignment(prop) || ts.isMethodDeclaration(prop)) {
		const n = prop.name;
		if (ts.isIdentifier(n)) return n.text;
		if (ts.isStringLiteral(n)) return n.text;
		if (ts.isNumericLiteral(n)) return n.text;
	}
	if (ts.isShorthandPropertyAssignment(prop)) return prop.name.text;
	return null;
}

function objectLiteralKeys(node, prefix = "") {
	const leafPaths = [];
	if (!ts.isObjectLiteralExpression(node)) return leafPaths;

	for (const prop of node.properties) {
		if (ts.isSpreadAssignment(prop)) continue;
		const name = propertyName(prop);
		if (!name) continue;
		const keyPath = prefix ? `${prefix}.${name}` : name;

		let init = null;
		if (ts.isPropertyAssignment(prop)) init = prop.initializer;
		if (init && ts.isAsExpression(init)) init = init.expression;

		if (init && ts.isObjectLiteralExpression(init)) {
			leafPaths.push(...objectLiteralKeys(init, keyPath));
		} else {
			leafPaths.push(keyPath);
		}
	}
	return leafPaths;
}

function exportsFromFile(filePath) {
	const source = fs.readFileSync(filePath, "utf8");
	const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
	const out = new Map();

	function visit(node) {
		if (
			ts.isVariableStatement(node) &&
			node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
		) {
			for (const decl of node.declarationList.declarations) {
				if (!ts.isIdentifier(decl.name)) continue;
				const exportName = decl.name.text;
				let init = decl.initializer;
				if (!init) continue;
				if (ts.isAsExpression(init)) init = init.expression;
				if (ts.isObjectLiteralExpression(init)) {
					out.set(exportName, objectLiteralKeys(init));
				}
			}
		}
		ts.forEachChild(node, visit);
	}
	visit(sf);
	return out;
}

function listLocaleFiles(dir) {
	return fs
		.readdirSync(dir)
		.filter((f) => f.endsWith(".ts") && f !== "index.ts")
		.sort();
}

function parseIndex(indexPath) {
	const source = fs.readFileSync(indexPath, "utf8");
	const imports = [...source.matchAll(/^import\s+.+from\s+["']\.\/([^"']+)["'];?/gm)].map(
		(m) => m[1],
	);
	const exportMatch = source.match(/export const \w+ = \{([\s\S]*?)\} as const;/);
	const exportKeys = exportMatch
		? [...exportMatch[1].matchAll(/^\s*(\w+),?\s*$/gm)].map((m) => m[1])
		: [];
	return { imports, exportKeys };
}

const enFiles = listLocaleFiles(enDir);
const zhFiles = listLocaleFiles(zhDir);
const enOnly = enFiles.filter((f) => !zhFiles.includes(f));
const zhOnly = zhFiles.filter((f) => !enFiles.includes(f));

console.log("=== index.ts ===");
const enIndex = parseIndex(path.join(enDir, "index.ts"));
const zhIndex = parseIndex(path.join(zhDir, "index.ts"));
const importDiffEn = enIndex.imports.filter((i) => !zhIndex.imports.includes(i));
const importDiffZh = zhIndex.imports.filter((i) => !enIndex.imports.includes(i));
const exportDiffEn = enIndex.exportKeys.filter((k) => !zhIndex.exportKeys.includes(k));
const exportDiffZh = zhIndex.exportKeys.filter((k) => !enIndex.exportKeys.includes(k));
console.log(
	importDiffEn.length || importDiffZh.length
		? `import mismatch en-only: ${importDiffEn.join(", ") || "none"} | zh-only: ${importDiffZh.join(", ") || "none"}`
		: "imports: MATCH",
);
console.log(
	exportDiffEn.length || exportDiffZh.length
		? `export keys mismatch en-only: ${exportDiffEn.join(", ") || "none"} | zh-only: ${exportDiffZh.join(", ") || "none"}`
		: "export keys: MATCH",
);

if (enOnly.length) console.log("Files in en only:", enOnly.join(", "));
if (zhOnly.length) console.log("Files in zh only:", zhOnly.join(", "));

console.log("\n=== Missing zh keys (en → zh), by file ===");
const summary = [];
let totalMissing = 0;

for (const file of enFiles) {
	const enPath = path.join(enDir, file);
	const zhPath = path.join(zhDir, file);
	if (!fs.existsSync(zhPath)) {
		const enExports = exportsFromFile(enPath);
		let count = 0;
		for (const keys of enExports.values()) count += keys.length;
		summary.push({ file, missing: count, note: "zh file missing" });
		totalMissing += count;
		continue;
	}

	const enExports = exportsFromFile(enPath);
	const zhExports = exportsFromFile(zhPath);
	let fileMissing = 0;
	const details = [];

	for (const [exportName, enKeys] of enExports) {
		const zhKeys = zhExports.get(exportName);
		if (!zhKeys) {
			fileMissing += enKeys.length;
			details.push(`${exportName}: entire export missing (${enKeys.length} keys)`);
			continue;
		}
		const zhSet = new Set(zhKeys);
		const missing = enKeys.filter((k) => !zhSet.has(k));
		if (missing.length) {
			fileMissing += missing.length;
			details.push(`${exportName}: ${missing.length} missing`);
		}
	}

	for (const exportName of zhExports.keys()) {
		if (!enExports.has(exportName)) {
			details.push(`${exportName}: extra export in zh (not in en)`);
		}
	}

	if (fileMissing > 0) {
		summary.push({ file, missing: fileMissing, details });
		totalMissing += fileMissing;
	}
}

if (summary.length === 0) {
	console.log("All locale files: structural keys match (0 missing in zh).");
} else {
	for (const { file, missing, note, details } of summary) {
		console.log(`${file}: ${missing} missing${note ? ` (${note})` : ""}`);
		if (details?.length) {
			for (const d of details) console.log(`  - ${d}`);
		}
	}
	console.log(`\nTotal missing zh keys: ${totalMissing} across ${summary.length} file(s)`);

	console.log("\n=== Sample missing paths (up to 5 per file) ===");
	for (const file of enFiles) {
		const enPath = path.join(enDir, file);
		const zhPath = path.join(zhDir, file);
		if (!fs.existsSync(zhPath)) continue;
		const enExports = exportsFromFile(enPath);
		const zhExports = exportsFromFile(zhPath);
		const samples = [];
		for (const [exportName, enKeys] of enExports) {
			const zhSet = new Set(zhExports.get(exportName) ?? []);
			for (const k of enKeys) {
				if (!zhSet.has(k)) samples.push(`${exportName}.${k}`);
			}
		}
		if (samples.length) {
			console.log(`${file}:`);
			for (const s of samples.slice(0, 5)) console.log(`  ${s}`);
			if (samples.length > 5) console.log(`  ... +${samples.length - 5} more`);
		}
	}
}
