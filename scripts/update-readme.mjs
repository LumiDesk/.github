#!/usr/bin/env node
// 自动刷新组织主页 README 里的「开源项目表」。
//
// 用法：
//   node scripts/update-readme.mjs            # 拉取公开仓库并更新 profile/README.md
//   GITHUB_TOKEN=xxx node scripts/...         # 可选：带 token 仅为提高 API 速率上限
//
// 只读取「公开」仓库（主页是公开的，不暴露私有仓库），因此默认无需 token。
// 会把生成的表格注入到 README 中 <!-- REPOS:START --> 与 <!-- REPOS:END --> 之间。

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ORG = 'LumiDesk';
const SELF = '.github'; // 主页仓库自身，不列入表格
const START = '<!-- REPOS:START -->';
const END = '<!-- REPOS:END -->';

const __dirname = dirname(fileURLToPath(import.meta.url));
const README = join(__dirname, '..', 'profile', 'README.md');

async function fetchAllRepos(org) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'lumidesk-readme-bot',
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const repos = [];
  for (let page = 1; ; page++) {
    const url = `https://api.github.com/orgs/${org}/repos?type=public&per_page=100&page=${page}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error(`GitHub API ${res.status} ${res.statusText}\n${await res.text()}`);
    }
    const batch = await res.json();
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  return repos;
}

// markdown 表格单元格转义：竖线、换行会破坏表格结构
function cell(text) {
  return (text || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

function buildTable(repos) {
  const visible = repos
    .filter((r) => !r.private && !r.fork && !r.archived && r.name !== SELF)
    .sort(
      (a, b) =>
        b.stargazers_count - a.stargazers_count ||
        new Date(b.pushed_at) - new Date(a.pushed_at),
    );

  const header = [
    '| 项目 | 简介 | 语言 | Stars |',
    '| --- | --- | --- | :---: |',
  ];

  const rows = visible.map((r) => {
    const name = `[${r.name}](${r.html_url})`;
    const desc = cell(r.description) || '—';
    const lang = r.language || '—';
    return `| ${name} | ${desc} | ${lang} | ${r.stargazers_count} |`;
  });

  if (rows.length === 0) {
    rows.push('| — | 暂无公开项目，敬请期待 | — | — |');
  }

  return { table: [...header, ...rows].join('\n'), count: visible.length };
}

async function main() {
  const repos = await fetchAllRepos(ORG);
  const { table, count } = buildTable(repos);

  const readme = await readFile(README, 'utf8');
  const region = new RegExp(`${START}[\\s\\S]*?${END}`);
  if (!region.test(readme)) {
    throw new Error(
      `未在 ${README} 中找到标记 ${START} ... ${END}，请先在 README 里放好这对标记。`,
    );
  }

  const replacement = `${START}\n\n${table}\n\n${END}`;
  const updated = readme.replace(region, replacement);

  if (updated === readme) {
    console.log(`项目表无变化（${count} 个公开项目），README 未改动。`);
    return;
  }

  await writeFile(README, updated);
  console.log(`已更新 README：${count} 个公开项目。`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
