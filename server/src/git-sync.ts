import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { config } from './config.js';

const execAsync = promisify(exec);

async function runGit(command: string, cwd: string) {
  try {
    const { stdout, stderr } = await execAsync(`git ${command}`, { cwd });
    return { stdout, stderr, success: true };
  } catch (error: any) {
    return { stdout: error.stdout, stderr: error.stderr, success: false, error };
  }
}

async function isGitRepo(dir: string): Promise<boolean> {
  try {
    await fs.access(path.join(dir, '.git'));
    return true;
  } catch {
    return false;
  }
}

export async function initGitSync() {
  if (!config.gitSyncRepo) {
    console.log('[Git Sync] Disabled (GIT_SYNC_REPO not set).');
    return;
  }

  const vaultPath = config.defaultVaultPath;
  console.log(`[Git Sync] Initializing for ${vaultPath}...`);

  await fs.mkdir(vaultPath, { recursive: true });

  const isRepo = await isGitRepo(vaultPath);

  // Setup config every time just to be safe
  const setupConfig = async () => {
    await runGit(`config user.name "${config.gitSyncName}"`, vaultPath);
    await runGit(`config user.email "${config.gitSyncEmail}"`, vaultPath);
    await runGit('config pull.rebase false', vaultPath);
  };

  if (!isRepo) {
    console.log('[Git Sync] Vault is not a Git repository. Initializing...');
    await runGit('init', vaultPath);
    await runGit(`remote add origin "${config.gitSyncRepo}"`, vaultPath);
    await setupConfig();
    
    console.log('[Git Sync] Fetching from remote...');
    await runGit('fetch origin', vaultPath);

    // Try to reset hard to remote main or master to avoid any merge conflicts with local default files
    const resetMain = await runGit('reset --hard origin/main', vaultPath);
    if (!resetMain.success) {
      const resetMaster = await runGit('reset --hard origin/master', vaultPath);
      if (!resetMaster.success) {
         console.warn('[Git Sync] Remote might be empty or auth failed. Starting fresh.');
      } else {
         await runGit('branch -M master', vaultPath);
      }
    } else {
      await runGit('branch -M main', vaultPath);
    }
  } else {
    console.log('[Git Sync] Vault is already a Git repository. Pulling latest changes...');
    await setupConfig();
    
    // We try to pull. If it fails due to divergence, we just warn.
    const pullResult = await runGit('pull origin', vaultPath);
    if (!pullResult.success) {
       console.warn('[Git Sync] Failed to pull latest changes:', pullResult.stderr || pullResult.error?.message);
    } else {
       console.log('[Git Sync] Pull successful.');
    }
  }
}

export function startGitSyncCron() {
  if (!config.gitSyncRepo) return;

  const vaultPath = config.defaultVaultPath;
  const intervalMs = config.gitSyncInterval;

  console.log(`[Git Sync] Starting auto-sync cron job (every ${intervalMs / 1000 / 60} minutes).`);

  setInterval(async () => {
    try {
      const status = await runGit('status --porcelain', vaultPath);
      if (status.success && status.stdout && status.stdout.trim().length > 0) {
        console.log('[Git Sync] Changes detected. Committing and pushing...');
        await runGit('add .', vaultPath);
        const commit = await runGit('commit -m "Auto-sync via WebObsidian"', vaultPath);
        if (commit.success) {
          const push = await runGit('push -u origin HEAD', vaultPath);
          if (push.success) {
            console.log('[Git Sync] Successfully pushed changes to GitHub.');
          } else {
            console.error('[Git Sync] Failed to push changes:', push.stderr || push.error?.message);
          }
        }
      }
    } catch (e) {
      console.error('[Git Sync] Unexpected error during auto-sync:', e);
    }
  }, intervalMs);
}
