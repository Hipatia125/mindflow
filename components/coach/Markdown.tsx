"use client";

import * as React from "react";

/**
 * 轻量 Markdown 渲染器（零依赖，专门服务 AI 教练的回复）。
 *
 * 支持：标题（#/##/###）、无序列表（- / *）、有序列表（1.）、
 *       行内 **加粗** / *斜体* / `代码`、普通段落（保留换行）。
 *
 * 设计要点：对「未闭合」的标记（如打字机逐字输出到一半的 `**`）
 * 一律按字面文本渲染，绝不让中途状态崩溃或丢字。
 */

/** 把行内 `**加粗**` / `*斜体*` / `` `代码` `` 转成 React 节点 */
function renderInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // 依次匹配：加粗（**）→ 代码（`）→ 斜体（*）
  const regex = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith("**") && token.endsWith("**") && token.length > 4) {
      nodes.push(
        <strong key={key++} className="font-semibold text-foreground">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith("`") && token.endsWith("`") && token.length > 2) {
      nodes.push(
        <code
          key={key++}
          className="rounded bg-muted/70 px-1 py-0.5 font-mono text-[0.85em] text-primary-700"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith("*") && token.endsWith("*") && token.length > 2) {
      nodes.push(
        <em key={key++} className="italic">
          {token.slice(1, -1)}
        </em>
      );
    } else {
      nodes.push(token);
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

/** 单行渲染：识别标题 / 列表项，否则当作段落 */
function renderLine(line: string, key: number): React.ReactNode {
  const heading = line.match(/^(#{1,3})\s+(.*)$/);
  if (heading) {
    const level = heading[1].length;
    const cls =
      level === 1
        ? "text-base font-bold"
        : level === 2
          ? "text-[15px] font-bold"
          : "text-sm font-semibold";
    return (
      <p key={key} className={cls}>
        {renderInline(heading[2])}
      </p>
    );
  }

  const bullet = line.match(/^\s*[-*]\s+(.*)$/);
  if (bullet) {
    return (
      <li key={key} className="flex gap-1.5">
        <span className="text-primary-400">•</span>
        <span>{renderInline(bullet[1])}</span>
      </li>
    );
  }

  const ordered = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
  if (ordered) {
    return (
      <li key={key} className="flex gap-1.5">
        <span className="font-medium text-primary-400">{ordered[1]}.</span>
        <span>{renderInline(ordered[2])}</span>
      </li>
    );
  }

  if (line.trim() === "") {
    return <div key={key} className="h-1.5" />;
  }

  return <p key={key}>{renderInline(line)}</p>;
}

/** 把整段 Markdown 文本渲染为 React 节点数组（逐行分组列表） */
export function renderMarkdown(text: string): React.ReactNode[] {
  if (!text) return [];
  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  let key = 0;

  // 分组连续的列表项，让它们包在同一个 <ul>/<ol> 里
  let listBuf: { type: "ul" | "ol"; items: React.ReactNode[] } | null = null;

  const flushList = () => {
    if (!listBuf) return;
    const { type, items } = listBuf;
    out.push(
      type === "ul" ? (
        <ul key={key++} className="my-1 space-y-1">
          {items}
        </ul>
      ) : (
        <ol key={key++} className="my-1 space-y-1">
          {items}
        </ol>
      )
    );
    listBuf = null;
  };

  for (const line of lines) {
    const isBullet = /^\s*[-*]\s+/.test(line);
    const isOrdered = /^\s*\d+[.)]\s+/.test(line);

    if (isBullet || isOrdered) {
      const type = isOrdered ? "ol" : "ul";
      if (!listBuf || listBuf.type !== type) {
        flushList();
        listBuf = { type, items: [] };
      }
      const itemKey = key++;
      listBuf.items.push(renderLine(line, itemKey));
    } else {
      flushList();
      out.push(renderLine(line, key++));
    }
  }
  flushList();

  return out;
}
