import type { Report } from './api';

export function downloadFile(name: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function reportToMarkdown(r: Report): string {
  const lines: string[] = [];
  lines.push(`# Team Coder — Contribution Report`);
  lines.push(`\n_Generated ${new Date(r.generatedAt).toLocaleString()}_\n`);
  lines.push(`**Totals:** ${r.totals.commits} commits · +${r.totals.linesAdded} lines · ${r.totals.tasksCompleted} tasks done · ${r.totals.activeMinutes} active min\n`);

  lines.push(`## Contribution by coder\n`);
  lines.push(`| Coder | Blended % | Commits | +Lines | Files | Edits | Tasks | Decisions | Patterns |`);
  lines.push(`|---|--:|--:|--:|--:|--:|--:|--:|--:|`);
  for (const c of r.coders) {
    lines.push(`| ${c.name} | ${c.pct.blended}% | ${c.commits} | ${c.linesAdded} | ${c.filesTouched} | ${c.edits} | ${c.tasksCompleted} | ${c.decisions} | ${c.patterns} |`);
  }

  lines.push(`\n## Module breakdown (by lines)\n`);
  for (const m of r.modules) {
    lines.push(`### ${m.name} \`${m.pathPrefix}\` — ${m.totalLines} lines`);
    if (m.contributors.length === 0) {
      lines.push(`_no commits yet_`);
    } else {
      for (const c of m.contributors) lines.push(`- ${c.name}: ${c.lines} lines (${c.pct}%)`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
