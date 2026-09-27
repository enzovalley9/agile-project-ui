import { test, expect } from './filesystem';
import AxeBuilder from '@axe-core/playwright';

for (const [provider, name, port] of [
  ['git', 'Git', 43120],
  ['jira', 'Jira', 43121],
  ['confluence', 'Confluence', 43122],
] as const) {
  test(`${name} provides complete public setup steps for each system and returns to the unchanged connection flow`, async ({
    page,
    project,
  }, info) => {
    void project;
    await page.goto('/');
    await page.getByRole('button', { name: 'Choose project folder' }).click();
    await page
      .getByRole('combobox', { name: 'Theme', exact: true })
      .selectOption(provider === 'jira' ? 'dark' : 'light');
    await page.getByRole('button', { name: new RegExp(`Connect to ${name}`) }).click();
    await page.getByRole('button', { name: `Install ${name} connector`, exact: true }).click();
    const guide = page.getByRole('dialog', {
      name: `Install and start the ${name} connector`,
      exact: true,
    });
    await expect(guide).toBeVisible();
    await expect(
      guide.getByRole('link', { name: 'Download connectors', exact: true }),
    ).toHaveAttribute('href', 'https://github.com/enzovalley9/bmad-project-ui/releases');
    await expect(guide).not.toContainText(/private artifacts|private packages/i);
    await expect(guide.getByRole('heading', { name: 'Prepare the local files' })).toBeVisible();
    const start = guide.getByRole('region', { name: `Start the ${name} connector`, exact: true });
    for (const os of ['macos', 'windows', 'linux']) {
      await guide.getByRole('combobox', { name: 'Operating system', exact: true }).selectOption(os);
      await expect(
        guide.getByRole('region', { name: 'Install the package', exact: true }),
      ).toContainText(
        os === 'windows' ? '.\\install.cmd' : os === 'macos' ? './install.command' : './install.sh',
      );
      await expect(start).toContainText(
        os === 'windows' ? '.\\bmad-connectors.cmd' : './bmad-connectors',
      );
      await expect(start).toContainText("--origin 'http://127.0.0.1:5173'");
      await expect(start).toContainText(`${provider}-session`);
      await expect(guide).toContainText(`http://127.0.0.1:${port}`);
      if (provider === 'git') {
        await expect(start).toContainText('--repo');
        await expect(start).not.toContainText('--credentials-file');
      } else {
        await expect(start).toContainText(`--provider ${provider}`);
        await expect(start).toContainText(`--credentials-file`);
        await expect(start).not.toContainText('--repo');
        await expect(guide).toContainText('does not open the repository or run Git');
      }
    }
    if (provider !== 'git') {
      await guide
        .getByRole('combobox', { name: `${name} deployment`, exact: true })
        .selectOption('data-center');
      await expect(start).toContainText('--deployment data-center');
      await expect(
        guide.getByRole('region', { name: 'Provider credentials file', exact: true }),
      ).toContainText('bearerToken');
      await guide
        .getByRole('combobox', { name: `${name} deployment`, exact: true })
        .selectOption('cloud');
      await expect(start).toContainText("--instance 'https://your-team.atlassian.net'");
      await expect(
        guide.getByRole('region', { name: 'Provider credentials file', exact: true }),
      ).toContainText('apiToken');
      if (provider === 'confluence') await expect(guide).toContainText('without /wiki');
    }
    await guide.getByText('Alternative: run from source', { exact: true }).click();
    await expect(guide.getByRole('region', { name: 'Run from source', exact: true })).toContainText(
      `npm run connector:${provider === 'git' ? 'git' : 'atlassian'} --`,
    );
    await guide.getByText('Troubleshooting', { exact: true }).click();
    await expect(guide.getByText('Cannot reach the connector', { exact: true })).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(
      results.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? '')),
    ).toEqual([]);
    await guide.evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.screenshot({ path: info.outputPath(`${provider}-setup.png`) });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await guide.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    await guide
      .getByRole('heading', { name: `Start ${name}`, exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`${provider}-setup-narrow.png`) });
    await page.keyboard.press('Escape');
    await expect(guide).toHaveCount(0);
    if (provider !== 'git') {
      await page.getByRole('button', { name: 'Set up connection', exact: true }).click();
      await page
        .getByRole('button', { name: 'Installation and startup instructions', exact: true })
        .click();
      await expect(guide).toBeVisible();
      await guide.getByRole('button', { name: 'Back to connection', exact: true }).click();
      await page.getByRole('button', { name: 'Next', exact: true }).click();
      await expect(
        page.getByRole('textbox', { name: `Local connector address for ${name}`, exact: true }),
      ).toHaveValue(`http://127.0.0.1:${port}`);
    } else {
      await expect(
        page.getByRole('textbox', { name: 'Local connector address', exact: true }),
      ).toHaveValue(`http://127.0.0.1:${port}`);
    }
  });
}
