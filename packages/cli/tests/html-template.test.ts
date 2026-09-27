import { describe, it, expect } from 'vitest';
import { escapeHtml, renderDashboardHtml } from '../src/html-template.js';
import { buildDailyReportSections } from '../src/report-sections.js';
import type { ReportData } from '../src/report-data.js';

describe('escapeHtml', () => {
  it("escapes <, >, &, \", and ' (Review Focus: dashboard opens in a real browser)", () => {
    expect(escapeHtml(`<script>alert('x')</script>&"`)).toBe('&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;&amp;&quot;');
  });
  it('leaves a plain string unchanged', () => {
    expect(escapeHtml('json-workbench')).toBe('json-workbench');
  });
});

describe('renderDashboardHtml', () => {
  it('produces a full HTML document with the generated timestamp and every panel heading', () => {
    const data: ReportData = { products: [], portfolioPnl: null };
    const html = renderDashboardHtml(buildDailyReportSections(data), [], { generatedAt: '2026-09-27T00:00:00.000Z', aiBudgetCents: 10000 });
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain('2026-09-27T00:00:00.000Z');
    expect(html).toContain('Company Health');
    expect(html).toContain('Contribution Trend');
    expect(html).toContain('Pending Approvals');
    expect(html).toContain('no data (Paperclip approvals not wired up yet)');
  });

  it('escapes a malicious product id/metric name embedded in a winner anomaly instead of injecting a tag (Review Focus)', () => {
    const data: ReportData = {
      products: [{
        product: '<img src=x onerror=alert(1)>',
        latestByMetric: {},
        anomalies: [{ product: '<img src=x onerror=alert(1)>', name: 'installs', date: '2026-09-07', value: 1, trailingMean: 1, trailingStdDev: 1, zScore: 1, direction: 'up' }],
        pnl: null,
      }],
      portfolioPnl: null,
    };
    const html = renderDashboardHtml(buildDailyReportSections(data), [], { generatedAt: '2026-09-27T00:00:00.000Z', aiBudgetCents: 10000 });
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('renders a real trend table row when a contribution trend point is given', () => {
    const html = renderDashboardHtml(buildDailyReportSections({ products: [], portfolioPnl: null }), [{ date: '2026-09-05', contributionCents: 250 }], { generatedAt: 'x', aiBudgetCents: 10000 });
    expect(html).toContain('2026-09-05');
    expect(html).toContain('$2.50');
  });
});
