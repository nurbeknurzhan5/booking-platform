import { promises as fs } from 'node:fs';
import path from 'node:path';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

const DOCS = { privacy: 'privacy.md', terms: 'terms.md', processing: 'processing.md' } as const;

export function generateStaticParams() {
  return Object.keys(DOCS).map((doc) => ({ doc }));
}

/** Минимальный рендер собственного markdown (заголовки, абзацы, списки, таблицы, цитаты). */
function render(md: string): ReactNode[] {
  const out: ReactNode[] = [];
  const lines = md.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const l = lines[i]!;
    if (!l.trim()) { i++; continue; }
    if (l.startsWith('# ')) out.push(<h1 key={i} className="mb-4 text-2xl font-semibold">{l.slice(2)}</h1>);
    else if (l.startsWith('## ')) out.push(<h2 key={i} className="mb-2 mt-6 text-lg font-semibold">{l.slice(3)}</h2>);
    else if (l.startsWith('> ')) out.push(<p key={i} className="my-3 rounded bg-amber-50 p-3 text-sm text-amber-900">{l.slice(2)}</p>);
    else if (/^\s*(-|\d+\.)\s/.test(l)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*(-|\d+\.)\s/.test(lines[i]!)) items.push(lines[i++]!.replace(/^\s*(-|\d+\.)\s/, ''));
      out.push(<ul key={`u${i}`} className="my-2 list-disc space-y-1 pl-6">{items.map((t, k) => <li key={k}>{t}</li>)}</ul>);
      continue;
    } else if (l.startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.startsWith('|')) {
        const cells = lines[i++]!.split('|').slice(1, -1).map((c) => c.trim());
        if (!cells.every((c) => /^-+$/.test(c))) rows.push(cells);
      }
      out.push(
        <div key={`t${i}`} className="my-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <tbody>{rows.map((r, k) => <tr key={k} className="border-b">{r.map((c, j) => <td key={j} className={`px-2 py-1 align-top ${k === 0 ? 'font-semibold' : ''}`}>{c.replace(/`/g, '')}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    } else out.push(<p key={i} className="my-2 leading-relaxed">{l}</p>);
    i++;
  }
  return out;
}

export default async function LegalPage({ params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params;
  const file = DOCS[doc as keyof typeof DOCS];
  if (!file) notFound();
  const md = await fs.readFile(path.join(process.cwd(), 'content', 'legal', file), 'utf8');
  return <main className="mx-auto max-w-3xl px-4 py-8">{render(md)}</main>;
}
