import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  type CaseResult,
  checkValue,
  type Language,
  type PracticeQuestion,
  type TestCase,
  type ValueType,
} from "@/lib/practice-questions";

// Runs a question's solution against its test cases on this computer (the Rust `run_solution` command), with the
// languages installed here. The author's code gets a driver added: it reads one test case's values from stdin, calls
// the method, and prints the result as JSON after RESULT_MARKER, which is compared with the expected value.
//
// Values reach the driver one per line: a number, true/false, or a string's text. A list is its length on one line,
// then its items (ints space-separated on one line, strings one per line). The same scheme as PrepCode's drivers, so
// a case behaves the same for authors and students.

const RESULT_MARKER = "<<prepwisely-result>>";

type Param = { name: string; type: ValueType };
type Signature = { method: string; params: Param[]; returns: ValueType };

/** One case's values as the driver reads them. */
function encodeInput(signature: Signature, values: unknown[]): string {
  return (
    signature.params
      .flatMap(({ type }, i) => {
        const value = values[i];
        if (type === "int[]") return [String((value as number[]).length), (value as number[]).join(" ")];
        if (type === "string[]") return [String((value as string[]).length), ...(value as string[])];
        return [String(value)];
      })
      .join("\n") + "\n"
  );
}

const callArgs = (s: Signature) => s.params.map((p) => p.name).join(", ");

// --- Python ----------------------------------------------------------------------------------------------------

const PY_READ: Record<ValueType, string> = {
  int: "int(_pw_line())",
  long: "int(_pw_line())",
  bool: '_pw_line().strip() == "true"',
  string: "_pw_line()",
  "int[]": "(_pw_line(), [int(x) for x in _pw_line().split()])[1]",
  "string[]": "[_pw_line() for _ in range(int(_pw_line()))]",
};

const python = (s: Signature, code: string) => String.raw`${code}


import sys as _pw_sys, json as _pw_json

_pw_lines = _pw_sys.stdin.read().split("\n")
_pw_at = 0


def _pw_line():
    global _pw_at
    _pw_at += 1
    return _pw_lines[_pw_at - 1] if _pw_at <= len(_pw_lines) else ""


${s.params.map((p) => `${p.name} = ${PY_READ[p.type]}`).join("\n")}
_pw_result = Solution().${s.method}(${callArgs(s)})
print("\n${RESULT_MARKER}")
print(_pw_json.dumps(_pw_result, ensure_ascii=False, separators=(",", ":")))
`;

// --- Java ------------------------------------------------------------------------------------------------------

const javaRead = ({ name, type }: Param) =>
  ({
    int: `int ${name}=Integer.parseInt(pwLine().trim());`,
    long: `long ${name}=Long.parseLong(pwLine().trim());`,
    bool: `boolean ${name}=pwLine().trim().equals("true");`,
    string: `String ${name}=pwLine();`,
    "int[]": `pwLine();int[] ${name}=pwInts(pwLine());`,
    "string[]": `String[] ${name}=new String[Integer.parseInt(pwLine().trim())];for(int i=0;i<${name}.length;i++)${name}[i]=pwLine();`,
  })[type];

const JAVA_IMPORT = /^\s*import\s+[\w.]+(\s*\.\s*\*)?\s*;\s*$/;

/** The driver class goes first, on the author's first line, so compile errors keep their line numbers. */
function java(s: Signature, code: string) {
  const lines = code.split("\n");
  const imports = lines.filter((l) => JAVA_IMPORT.test(l)).map((l) => l.trim());
  const rest = lines.map((l) => (JAVA_IMPORT.test(l) ? "" : l));
  const driver = String.raw`import java.util.*;import java.io.*;${imports.join("")}public class PwMain{static BufferedReader pwIn=new BufferedReader(new InputStreamReader(System.in));static String pwLine()throws IOException{String s=pwIn.readLine();return s==null?"":s;}static int[] pwInts(String s){s=s.trim();if(s.isEmpty())return new int[0];String[] p=s.split("\\s+");int[] r=new int[p.length];for(int i=0;i<p.length;i++)r[i]=Integer.parseInt(p[i]);return r;}static String pwQ(String s){return s==null?"null":"\""+s.replace("\\","\\\\").replace("\"","\\\"")+"\"";}static String pwF(Object v){if(v==null)return "null";if(v instanceof String s)return pwQ(s);if(v instanceof int[] a){StringBuilder b=new StringBuilder("[");for(int i=0;i<a.length;i++){if(i>0)b.append(',');b.append(a[i]);}return b.append(']').toString();}if(v instanceof String[] a){StringBuilder b=new StringBuilder("[");for(int i=0;i<a.length;i++){if(i>0)b.append(',');b.append(pwQ(a[i]));}return b.append(']').toString();}return String.valueOf(v);}public static void main(String[] args)throws Exception{${s.params.map(javaRead).join("")}var pwResult=new Solution().${s.method}(${callArgs(s)});System.out.print("\n${RESULT_MARKER}\n"+pwF(pwResult)+"\n");System.out.flush();}}`;
  rest[0] = driver + rest[0];
  return rest.join("\n");
}

// --- C# --------------------------------------------------------------------------------------------------------

const csRead = ({ name, type }: Param) =>
  ({
    int: `int ${name} = int.Parse(PwLine().Trim());`,
    long: `long ${name} = long.Parse(PwLine().Trim());`,
    bool: `bool ${name} = PwLine().Trim() == "true";`,
    string: `string ${name} = PwLine();`,
    "int[]": `PwLine(); int[] ${name} = System.Array.ConvertAll(PwLine().Split(' ', System.StringSplitOptions.RemoveEmptyEntries), int.Parse);`,
    "string[]": `string[] ${name} = new string[int.Parse(PwLine().Trim())]; for (int i = 0; i < ${name}.Length; i++) ${name}[i] = PwLine();`,
  })[type];

/** C# methods are PascalCase: isLeapYear -> IsLeapYear. */
const pascal = (name: string) => name[0].toUpperCase() + name.slice(1);

const csharp = (s: Signature, code: string) => String.raw`${code}

#nullable disable
static class PwMain
{
    static string PwLine() => System.Console.ReadLine() ?? "";
    static string PwQ(string s) => s == null ? "null" : "\"" + s.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
    static string PwF(object v) => v switch
    {
        null => "null",
        string s => PwQ(s),
        bool b => b ? "true" : "false",
        int[] a => "[" + string.Join(",", a) + "]",
        string[] a => "[" + string.Join(",", System.Array.ConvertAll(a, PwQ)) + "]",
        _ => System.Convert.ToString(v, System.Globalization.CultureInfo.InvariantCulture),
    };

    static void Main()
    {
${s.params.map((p) => `        ${csRead(p)}`).join("\n")}
        var pwResult = new Solution().${pascal(s.method)}(${callArgs(s)});
        System.Console.Write("\n${RESULT_MARKER}\n" + PwF(pwResult) + "\n");
    }
}
`;

// --- C++ -------------------------------------------------------------------------------------------------------

const cppRead = ({ name, type }: Param) =>
  ({
    int: `int ${name} = std::stoi(pw_line());`,
    long: `long long ${name} = std::stoll(pw_line());`,
    bool: `bool ${name} = pw_line() == "true";`,
    string: `std::string ${name} = pw_line();`,
    "int[]": `pw_line(); std::vector<int> ${name} = pw_ints(pw_line());`,
    "string[]": `std::vector<std::string> ${name}(std::stoi(pw_line())); for (auto& x : ${name}) x = pw_line();`,
  })[type];

const cpp = (s: Signature, code: string) => String.raw`#include <algorithm>
#include <climits>
#include <cmath>
#include <iostream>
#include <map>
#include <set>
#include <sstream>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>
using namespace std;
#line 1
${code}

static std::string pw_line() {
    std::string s;
    if (!std::getline(std::cin, s)) return "";
    if (!s.empty() && s.back() == '\r') s.pop_back();
    return s;
}
static std::vector<int> pw_ints(const std::string& s) {
    std::vector<int> r;
    std::istringstream in(s);
    for (int x; in >> x;) r.push_back(x);
    return r;
}
static std::string pw_f(const std::string& s) {
    std::string r = "\"";
    for (char c : s) {
        if (c == '"' || c == '\\') r += '\\';
        r += c;
    }
    return r + "\"";
}
static std::string pw_f(int v) { return std::to_string(v); }
static std::string pw_f(long long v) { return std::to_string(v); }
static std::string pw_f(bool v) { return v ? "true" : "false"; }
template <typename T>
static std::string pw_f(const std::vector<T>& v) {
    std::string r = "[";
    for (size_t i = 0; i < v.size(); i++) r += (i ? "," : "") + pw_f(v[i]);
    return r + "]";
}

int main() {
${s.params.map((p) => `    ${cppRead(p)}`).join("\n")}
    auto pw_result = Solution().${s.method}(${callArgs(s)});
    std::cout << "\n${RESULT_MARKER}\n" << pw_f(pw_result) << "\n";
    return 0;
}
`;

// --- C ---------------------------------------------------------------------------------------------------------

const C_SCALAR: Record<string, string> = { int: "int", long: "long long", bool: "bool", string: "char*" };
const isList = (t: ValueType) => t === "int[]" || t === "string[]";

const cRead = ({ name, type }: Param) =>
  ({
    int: `int ${name} = atoi(pw_line());`,
    long: `long long ${name} = atoll(pw_line());`,
    bool: `bool ${name} = strcmp(pw_line(), "true") == 0;`,
    string: `char* ${name} = pw_line();`,
    "int[]": `int ${name}Size = atoi(pw_line()); int* ${name} = pw_ints(pw_line(), ${name}Size);`,
    "string[]": `int ${name}Size = atoi(pw_line()); char** ${name} = malloc(sizeof(char*) * (${name}Size + 1)); for (int i = 0; i < ${name}Size; i++) ${name}[i] = pw_line();`,
  })[type];

const C_PRINT: Record<ValueType, string> = {
  int: `printf("%d", pw_result);`,
  long: `printf("%lld", pw_result);`,
  bool: `fputs(pw_result ? "true" : "false", stdout);`,
  string: `pw_q(pw_result);`,
  "int[]": `putchar('['); for (int i = 0; i < returnSize; i++) printf(i ? ",%d" : "%d", pw_result[i]); putchar(']');`,
  "string[]": `putchar('['); for (int i = 0; i < returnSize; i++) { if (i) putchar(','); pw_q(pw_result[i]); } putchar(']');`,
};

function c(s: Signature, code: string) {
  const args = s.params.flatMap(({ name, type }) => (isList(type) ? [name, `${name}Size`] : [name]));
  if (isList(s.returns)) args.push("&returnSize");
  const returnType = s.returns === "int[]" ? "int*" : s.returns === "string[]" ? "char**" : C_SCALAR[s.returns];
  return String.raw`#include <limits.h>
#include <math.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#line 1
${code}

static char* pw_line(void) {
    size_t cap = 64, len = 0;
    char* s = malloc(cap);
    int ch;
    while ((ch = getchar()) != EOF && ch != '\n') {
        if (len + 1 >= cap) s = realloc(s, cap *= 2);
        s[len++] = (char)ch;
    }
    if (len && s[len - 1] == '\r') len--;
    s[len] = 0;
    return s;
}
static int* pw_ints(const char* s, int count) {
    int* r = malloc(sizeof(int) * (count + 1));
    char* end;
    for (int i = 0; i < count; i++) {
        r[i] = (int)strtol(s, &end, 10);
        s = end;
    }
    return r;
}
static void pw_q(const char* s) {
    if (!s) {
        fputs("null", stdout);
        return;
    }
    putchar('"');
    for (; *s; s++) {
        if (*s == '"' || *s == '\\') putchar('\\');
        putchar(*s);
    }
    putchar('"');
}

int main(void) {
${s.params.map((p) => `    ${cRead(p)}`).join("\n")}
${isList(s.returns) ? "    int returnSize = 0;\n" : ""}    ${returnType} pw_result = ${s.method}(${args.join(", ")});
    printf("\n${RESULT_MARKER}\n");
    ${C_PRINT[s.returns]}
    printf("\n");
    return 0;
}
`;
}

const PROGRAMS: Record<Language, (s: Signature, code: string) => string> = { python, java, csharp, cpp, c };

// --- Running ---------------------------------------------------------------------------------------------------

export interface CaseOutput {
  stdout: string;
  stderr: string;
  exit_code: number | null;
  timed_out: boolean;
  millis: number;
}

interface RunReport {
  compile_error: string | null;
  /** Shorter than the inputs when a case timed out and the rest were skipped. */
  cases: CaseOutput[];
}

/** What the method returned (the text after the marker), or null when the program didn't get that far. */
function returnedValue(stdout: string): string | null {
  const text = stdout.replace(/\r\n/g, "\n");
  const marker = `\n${RESULT_MARKER}\n`;
  const at = text.lastIndexOf(marker);
  return at < 0 ? null : text.slice(at + marker.length).trim();
}

/** The last few lines of an error, enough to see what went wrong. */
function tail(text: string, lines = 12): string {
  const all = text.trim().split("\n");
  return (all.length > lines ? ["…", ...all.slice(-lines)] : all).join("\n");
}

export function judge(out: CaseOutput | undefined, expected: unknown): CaseResult {
  if (!out) return { status: "error", message: "Not run: an earlier case took too long" };
  if (out.timed_out) return { status: "error", message: "Took longer than 5 seconds (an endless loop?)" };
  const returned = returnedValue(out.stdout);
  if (returned === null) {
    return { status: "error", message: tail(out.stderr || out.stdout) || `Stopped with exit code ${out.exit_code ?? "?"}` };
  }
  let got: unknown;
  try {
    got = JSON.parse(returned);
  } catch {
    return { status: "failed", got: returned };
  }
  return JSON.stringify(got) === JSON.stringify(expected) ? { status: "passed" } : { status: "failed", got: JSON.stringify(got) };
}

export interface SolutionRun {
  /** Set when the code didn't compile; then no case ran. */
  compileError: string | null;
  /** By test case id. Cases with invalid values aren't run. */
  results: Record<string, CaseResult>;
}

/** The program to run and each runnable case's stdin; cases with invalid values get their result up front. */
export function prepareRun(q: PracticeQuestion, language: Language) {
  const code = q.solutions[language] ?? "";
  const signature: Signature = { method: q.method, params: q.params, returns: q.returns };

  const results: Record<string, CaseResult> = {};
  const runnable: { t: TestCase; input: string; expected: unknown }[] = [];
  for (const t of q.test_cases) {
    const values = q.params.map((p) => checkValue(p.type, t.inputs[p.id] ?? ""));
    const expected = checkValue(q.returns, t.expected);
    const bad = values.findIndex((v) => !v.ok);
    if (bad >= 0 || !expected.ok) {
      results[t.id] = { status: "error", message: bad >= 0 ? `Fix the value of ${q.params[bad].name || "a parameter"} first` : "Fix the expected value first" };
      continue;
    }
    runnable.push({ t, input: encodeInput(signature, values.map((v) => (v.ok ? v.value : null))), expected: expected.value });
  }
  return { source: PROGRAMS[language](signature, code), runnable, results };
}

/** Runs the question's `language` solution against every test case. */
export async function runSolution(q: PracticeQuestion, language: Language): Promise<SolutionRun> {
  if (!isTauri()) throw new Error("Solutions can only be run in the prepwisely desktop app.");
  const { source, runnable, results } = prepareRun(q, language);
  if (runnable.length === 0) return { compileError: null, results };

  const report = await invoke<RunReport>("run_solution", {
    language,
    source,
    inputs: runnable.map((r) => r.input),
  });
  if (report.compile_error !== null) return { compileError: report.compile_error, results };
  runnable.forEach((r, i) => {
    results[r.t.id] = judge(report.cases[i], r.expected);
  });
  return { compileError: null, results };
}
