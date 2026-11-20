import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const base = 'http://localhost:8889';
const profile = (id, role, divisions = ['cch', 'vfx']) => ({ id, username: id, displayName: id, role, divisions, title: '', bio: '', avatarUrl: '', createdAt: '2026-11-19T20:00:00Z' });
test('browser: owner/admin controls, card editing, staff moderation and responsive pages', async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    for (const role of ['owner', 'admin', 'staff', 'member']) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      let me = profile('current_' + role, role), member = profile('aerial', 'member');
      let members = [me, member, profile('captain', 'owner')], roster = [];
      const messages = [{ id: 'message', username: member.username, userId: member.id, channel: 'general', body: 'A clean double tap.', createdAt: '2026-11-19T20:00:00Z' }];
      const calls = [], errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.route('https://www.tiktok.com/embed.js', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
      await page.route('**/api/**', route => {
        const path = new URL(route.request().url()).pathname;
        let result = {};
        if (path.endsWith('/me')) result = { me };
        else if (path.endsWith('/public')) result = { members, roster, posts: [] };
        else {
          const p = route.request().postDataJSON(); calls.push(p);
          if (p.action === 'adminData') result = { members, roster, posts: [], invites: [], announcements: [], resources: [] };
          else if (p.action === 'hubData') result = { me, announcements: [], resources: [], moderationMembers: members };
          else if (p.action === 'messages') result = { messages, timeoutUntil: me.timeoutUntil };
          else if (p.action === 'updateProfile') { Object.assign(member, p); result = { ok: true }; }
          else if (p.action === 'addRoster') { roster.push({ ...p, id: 'new_entry' }); result = { ok: true }; }
          else if (p.action === 'deleteMessage') { messages.splice(0); result = { ok: true }; }
          else if (p.action === 'timeoutMember') { member.timeoutUntil = new Date(Date.now() + p.minutes * 60000).toISOString(); result = { ok: true }; }
        }
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(result) });
      });
      await page.goto(base + '/#/roster/owner');
      await page.getByRole('heading', { name: 'The roster.' }).waitFor();
      await page.getByRole('button', { name: 'Co-Owner', exact: false }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Admin', exact: false }).count(), 1);
      if (['owner', 'admin'].includes(role)) {
        await page.goto(base + '/#/admin');
        await page.getByRole('heading', { name: 'Team management.' }).waitFor();
        assert.equal(await page.getByRole('button', { name: /Generate token/ }).count(), role === 'owner' ? 1 : 0);
        assert.equal(await page.locator('input[name=days]').count(), 0);
        assert.equal(await page.locator('[data-delete="deleteMember"]').count() > 0, role === 'owner');
        await page.locator('[data-profile="aerial"]').click();
        await page.getByLabel('Display name').fill('Airborne');
        await page.getByRole('dialog').getByLabel('VFX', { exact: true }).uncheck();
        await page.getByRole('button', { name: 'Save changes' }).click();
        await page.getByRole('dialog').waitFor({ state: 'hidden' });
        assert.equal(member.displayName, 'Airborne');
        assert.deepEqual(member.divisions, ['cch']);
        assert.equal(calls.find(p => p.action === 'updateProfile').role, 'member');
        await page.getByRole('button', { name: 'Add entry' }).click();
        await page.getByLabel('Display name').fill('Boost unit');
        await page.getByLabel('Roster group').selectOption('co-owner');
        await page.getByRole('button', { name: 'Save changes' }).click();
        await page.getByRole('dialog').waitFor({ state: 'hidden' });
        assert.equal(roster[0].division, 'co-owner');
      }
      await page.goto(base + '/#/hub');
      await page.getByRole('heading', { name: 'The team hub.' }).waitFor();
      await page.getByText('A clean double tap.', { exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Remove message by aerial' }).count(), role === 'member' ? 0 : 1);
      if (role !== 'member') {
        await page.getByRole('button', { name: 'Timeout', exact: true }).click();
        await page.getByLabel('Duration').selectOption('30');
        await page.getByRole('button', { name: 'Save changes' }).click();
        await page.getByRole('dialog').waitFor({ state: 'hidden' });
        assert.equal(calls.find(p => p.action === 'timeoutMember').minutes, 30);
        await page.getByRole('button', { name: 'Moderation', exact: true }).click();
        await page.getByRole('heading', { name: 'Chat moderation' }).waitFor();
        await page.getByRole('button', { name: 'Team chat' }).click();
      }
      await page.getByRole('button', { name: '# tiktok', exact: true }).click();
      assert.equal(await page.locator('[data-unique-id="teamyvo"]').count(), 1);
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.goto(base + '/#/roster/cch');
      await page.getByRole('heading', { name: 'The roster.' }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(errors, []);
      await context.close();
    }
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    await page.route('**/api/me', route => route.fulfill({ contentType: 'application/json', body: '{"me":null}' }));
    await page.route('**/api/public', route => route.fulfill({ contentType: 'application/json', body: '{"members":[],"roster":[],"posts":[]}' }));
    await page.goto(base);
    await page.getByRole('heading', { name: /BUILT FOR/ }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await page.locator('body').innerText().then(s => /cchn/i.test(s)), false);
    await page.goto(base + '/#/login');
    await page.getByRole('button', { name: 'Activate your account' }).click();
    await page.getByLabel('Activation token').waitFor();
    assert.equal(await page.getByLabel('Repeat password').count(), 1);
    await page.close();
  } finally { await browser.close(); }
});
