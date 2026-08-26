import { ethers } from 'ethers';
import * as dotenv from 'dotenv';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const artifact = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), 'artifacts/contracts/UserRegistry.sol/UserRegistry.json'), 'utf8')
);

type WalletIndex = 1 | 2;
type LastWriteInput = {
  userId?: string;
  investments?: string;
  pnl?: string;
};

const ENV_PATH = path.resolve(process.cwd(), '.env');
const IS_TTY = Boolean(process.stdout.isTTY);

const COLOR = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
  bold: '\x1b[1m',
};

const lastWriteInput: LastWriteInput = {};

function paint(text: string, color: keyof typeof COLOR) {
  if (!IS_TTY) return text;
  return `${COLOR[color]}${text}${COLOR.reset}`;
}

function paintBold(text: string) {
  if (!IS_TTY) return text;
  return `${COLOR.bold}${text}${COLOR.reset}`;
}

function maskSecret(secret?: string) {
  const v = secret?.trim();
  if (!v) return 'missing';
  if (v.length <= 12) return `${v.slice(0, 2)}...${v.slice(-2)}`;
  return `${v.slice(0, 6)}...${v.slice(-4)}`;
}

function printBanner() {
  console.log('');
  console.log(paint('======================================', 'cyan'));
  console.log(paintBold('   User Registry CLI'));
  console.log(paint('======================================', 'cyan'));
}

function printConfigSummary() {
  const rpcUrl = process.env.RPC_URL?.trim();
  const contractAddress = process.env.CONTRACT_ADDRESS?.trim();

  const privateKey1 = process.env.PRIVATE_KEY_1?.trim();
  const privateKey2 = process.env.PRIVATE_KEY_2?.trim();
  const privateKey = process.env.PRIVATE_KEY?.trim();

  console.log('');
  console.log(paintBold('Configuration'));
  console.log(paint('--------------------------------------', 'gray'));
  console.log(`${paint('Env file:', 'gray')} ${ENV_PATH}`);
  console.log(`${paint('RPC_URL:', 'gray')} ${rpcUrl || '(missing)'}`);
  console.log(`${paint('CONTRACT_ADDRESS:', 'gray')} ${contractAddress || '(missing)'}`);
  console.log(`${paint('PRIVATE_KEY (manual/scripts wallet):', 'gray')} ${maskSecret(privateKey)}`);
  console.log(`${paint('PRIVATE_KEY_1 (wallet 1):', 'gray')} ${maskSecret(privateKey1)}`);
  console.log(`${paint('PRIVATE_KEY_2 (wallet 2):', 'gray')} ${maskSecret(privateKey2)}`);
  console.log(paint('--------------------------------------', 'gray'));
}

function printMenu() {
  console.log('');
  console.log(paintBold('Choose an option:'));
  console.log('1) Deploy');
  console.log('2) Register user');
  console.log('3) Update user');
  console.log('4) Read user');
  console.log('5) Exit');
}

function getErrorReason(error: unknown) {
  const err = error as any;

  const raw =
    err?.reason ||
    err?.revert?.args?.[0] ||
    err?.shortMessage ||
    err?.error?.reason ||
    err?.error?.message ||
    err?.message ||
    String(error);

  if (!raw) return 'Unknown error';

  // Keep output short and human-readable.
  const firstLine = String(raw).split('\n')[0].trim();
  const lowered = firstLine.toLowerCase();

  if (lowered.includes('unauthorized') && lowered.includes('ankr')) {
    return 'RPC unauthorized: add your Ankr API key to RPC_URL.';
  }
  if (lowered.includes('missing response for request')) {
    return 'RPC request failed. Check RPC_URL and network availability.';
  }

  const noActionTail = firstLine.split(' (action=')[0].trim();
  return noActionTail || 'Unknown error';
}

function createProvider(rpcUrl: string) {
  // staticNetwork avoids repeated network-detection retries and noisy logs
  // when the RPC endpoint is invalid/unauthorized.
  return new ethers.JsonRpcProvider(rpcUrl, undefined, { staticNetwork: true });
}

function validateRpcUrl(rpcUrl: string) {
  let parsed: URL;
  try {
    parsed = new URL(rpcUrl);
  } catch {
    throw new Error('RPC_URL is invalid. Please provide a full URL (http/https).');
  }

  if (parsed.hostname === 'rpc.ankr.com') {
    const segments = parsed.pathname.split('/').filter(Boolean);
    // Typical keyed format: /eth_sepolia/<apiKey>
    if (segments.length < 2) {
      throw new Error('RPC unauthorized: add your Ankr API key to RPC_URL.');
    }
  }
}

function escapeRegExp(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isProbablyAddress(value: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function formatEnvValue(key: string, value: string) {
  // Private keys tend to be hex strings; quoting avoids accidental parsing issues.
  const shouldQuote =
    key.toLowerCase().includes('private_key') ||
    value.trim().length === 0 ||
    /\s/.test(value) ||
    value.includes('#');

  const escaped = value.replace(/"/g, '\\"');
  return shouldQuote ? `${key}="${escaped}"` : `${key}=${value}`;
}

function upsertEnvVar(key: string, value: string) {
  if (!fs.existsSync(ENV_PATH)) {
    fs.writeFileSync(ENV_PATH, '', 'utf8');
  }

  const existing = fs.readFileSync(ENV_PATH, 'utf8');
  const escapedKey = escapeRegExp(key);
  const lineRegex = new RegExp(`^${escapedKey}=.*$`, 'm');

  const formatted = formatEnvValue(key, value);

  let next: string;
  if (lineRegex.test(existing)) {
    next = existing.replace(lineRegex, formatted);
  } else {
    const needsLeadingNewline = existing.length > 0 && !existing.endsWith('\n');
    next = `${existing}${needsLeadingNewline ? '\n' : ''}${formatted}\n`;
  }

  fs.writeFileSync(ENV_PATH, next, 'utf8');
  // Keep process.env in sync for the rest of this run.
  process.env[key] = value;
}

function parseBigInt(label: string, value: string) {
  try {
    return BigInt(value);
  } catch {
    throw new Error(`${label} must be an integer. Got: ${value}`);
  }
}

function getArgValue(argv: string[], name: string) {
  const prefixEq = `--${name}=`;
  for (const arg of argv) {
    if (arg.startsWith(prefixEq)) return arg.slice(prefixEq.length);
  }
  const prefix = `--${name}`;
  const idx = argv.indexOf(prefix);
  if (idx !== -1 && argv[idx + 1] && !argv[idx + 1].startsWith('--')) return argv[idx + 1];
  return undefined;
}

async function askNonEmpty(rl: ReturnType<typeof createInterface>, question: string) {
  while (true) {
    const ans = (await rl.question(question)).trim();
    if (ans.length > 0) return ans;
    console.log('Please enter a value.');
  }
}

async function askWithDefault(
  rl: ReturnType<typeof createInterface>,
  label: string,
  previous?: string
) {
  const suffix = previous ? ` [last: ${previous}]` : '';
  const raw = (await rl.question(`${label}${suffix}: `)).trim();
  if (raw.length > 0) return raw;
  if (previous) return previous;
  return askNonEmpty(rl, `${label}: `);
}

async function selectWallet(rl: ReturnType<typeof createInterface>) {
  while (true) {
    const ans = (await rl.question('Select wallet for write actions (`1` or `2`): ')).trim();
    if (ans === '1' || ans === '2') return Number(ans) as WalletIndex;
    console.log('Invalid selection. Choose `1` or `2`.');
  }
}

async function ensureRpcUrl(rl?: ReturnType<typeof createInterface>) {
  const rpcUrl = process.env.RPC_URL?.trim();
  if (rpcUrl) {
    validateRpcUrl(rpcUrl);
    return rpcUrl;
  }

  if (!rl) throw new Error('RPC_URL is not set. Please set it in .env or deploy via CLI prompts.');

  const nextRpcUrl = await askNonEmpty(rl, 'Enter RPC_URL (e.g. http://127.0.0.1:8545): ');
  validateRpcUrl(nextRpcUrl);
  upsertEnvVar('RPC_URL', nextRpcUrl);
  return nextRpcUrl;
}

async function ensureContractAddress(rl?: ReturnType<typeof createInterface>) {
  const contractAddress = process.env.CONTRACT_ADDRESS?.trim();
  if (contractAddress && isProbablyAddress(contractAddress)) return contractAddress;

  if (!rl) throw new Error('CONTRACT_ADDRESS is not set. Deploy first or set CONTRACT_ADDRESS in .env.');

  const answer = (await rl.question(
    'CONTRACT_ADDRESS is missing. Deploy now? (y/N): '
  )).trim().toLowerCase();

  if (answer === 'y' || answer === 'yes') {
    const walletIndex = await selectWallet(rl);
    await deployFlow(rl, walletIndex);
    const deployed = process.env.CONTRACT_ADDRESS?.trim();
    if (!deployed || !isProbablyAddress(deployed)) {
      throw new Error('Deployment finished, but CONTRACT_ADDRESS was not set correctly.');
    }
    return deployed;
  }

  throw new Error('Cannot continue without CONTRACT_ADDRESS.');
}

function getPrivateKeyForWallet(walletIndex: WalletIndex) {
  const direct = process.env[`PRIVATE_KEY_${walletIndex}`]?.trim();
  if (direct) return direct;

  // Backwards compatibility: if you only have one `PRIVATE_KEY` in .env, assume it is wallet 1.
  if (walletIndex === 1 && process.env.PRIVATE_KEY?.trim()) return process.env.PRIVATE_KEY.trim();

  return undefined;
}

async function ensurePrivateKey(walletIndex: WalletIndex, rl?: ReturnType<typeof createInterface>) {
  const existing = getPrivateKeyForWallet(walletIndex);
  if (existing) return existing;

  if (!rl) {
    throw new Error(
      `Private key for wallet ${walletIndex} is missing. Set PRIVATE_KEY_${walletIndex} in .env.`
    );
  }

  const answerKey = `PRIVATE_KEY_${walletIndex}`;
  const next = await askNonEmpty(
    rl,
    `Enter private key for wallet ${walletIndex} (${answerKey}): `
  );
  upsertEnvVar(answerKey, next);
  return next;
}

async function decodeReceiptEvents(contract: ethers.Contract, receipt: ethers.TransactionReceipt) {
  console.log('');
  console.log(paintBold('Event Logs'));
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed?.name === 'UserRegistered') {
        console.log('Event: UserRegistered');
        console.log(`  Owner: ${parsed.args.owner}`);
        console.log(`  UserId: ${parsed.args.userId}`);
        console.log(`  Investments: ${parsed.args.investments}`);
        console.log(`  PnL: ${parsed.args.pnl}`);
      } else if (parsed?.name === 'UserUpdated') {
        console.log('Event: UserUpdated');
        console.log(`  Owner: ${parsed.args.owner}`);
        console.log(`  UserId: ${parsed.args.userId}`);
        console.log(`  Investments: ${parsed.args.investments}`);
        console.log(`  PnL: ${parsed.args.pnl}`);
      }
    } catch {
      // Not one of the contract's events; ignore.
    }
  }
}

async function deployFlow(rl: ReturnType<typeof createInterface> | undefined, walletIndex: WalletIndex) {
  const rpcUrl = await ensureRpcUrl(rl);
  const privateKey = await ensurePrivateKey(walletIndex, rl);

  const provider = createProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);

  console.log('');
  console.log(paint(`Deploying from wallet ${walletIndex}: ${wallet.address} ...`, 'yellow'));
  const contractTx = await factory.deploy();
  await contractTx.waitForDeployment();

  const contractAddress = await contractTx.getAddress();
  console.log('');
  console.log(paint('Deployment Success', 'green'));
  console.log(`Contract: ${contractAddress}`);

  upsertEnvVar('CONTRACT_ADDRESS', contractAddress);
}

async function registerFlow(
  rl: ReturnType<typeof createInterface> | undefined,
  walletIndex: WalletIndex,
  input?: {
  userId: string;
  investments: string;
  pnl: string;
}
) {
  const contractAddress = await ensureContractAddress(rl);
  const rpcUrl = await ensureRpcUrl(rl);
  const privateKey = await ensurePrivateKey(walletIndex, rl);

  const provider = createProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const contract = new ethers.Contract(contractAddress, artifact.abi, wallet);

  const userIdStr =
    input?.userId ?? (await askWithDefault(rl!, 'User ID (uint256)', lastWriteInput.userId));
  const investmentsStr =
    input?.investments ??
    (await askWithDefault(rl!, 'Investments (uint256)', lastWriteInput.investments));
  const pnlStr =
    input?.pnl ?? (await askWithDefault(rl!, 'PnL (int256, can be negative)', lastWriteInput.pnl));

  const userId = parseBigInt('User ID', userIdStr);
  const investments = parseBigInt('Investments', investmentsStr);
  const pnl = parseBigInt('PnL', pnlStr);

  console.log('');
  console.log(paint(`Registering userId=${userId.toString()} from wallet ${walletIndex} ...`, 'yellow'));
  const tx = await contract.registerUser(userId, investments, pnl);
  console.log('');
  console.log(paint('Transaction Submitted', 'green'));
  console.log(`Hash: ${tx.hash}`);

  const receipt = await tx.wait();
  console.log('');
  console.log(paintBold('Transaction Receipt'));
  console.log(`Block number: ${receipt.blockNumber}`);
  console.log(`Gas used: ${receipt.gasUsed}`);

  lastWriteInput.userId = userIdStr;
  lastWriteInput.investments = investmentsStr;
  lastWriteInput.pnl = pnlStr;

  await decodeReceiptEvents(contract, receipt);
}

async function updateFlow(
  rl: ReturnType<typeof createInterface> | undefined,
  walletIndex: WalletIndex,
  input?: {
  userId: string;
  investments: string;
  pnl: string;
}
) {
  const contractAddress = await ensureContractAddress(rl);
  const rpcUrl = await ensureRpcUrl(rl);
  const privateKey = await ensurePrivateKey(walletIndex, rl);

  const provider = createProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const contract = new ethers.Contract(contractAddress, artifact.abi, wallet);

  const userIdStr =
    input?.userId ?? (await askWithDefault(rl!, 'User ID (uint256)', lastWriteInput.userId));
  const investmentsStr =
    input?.investments ??
    (await askWithDefault(rl!, 'Investments (uint256)', lastWriteInput.investments));
  const pnlStr =
    input?.pnl ?? (await askWithDefault(rl!, 'PnL (int256, can be negative)', lastWriteInput.pnl));

  const userId = parseBigInt('User ID', userIdStr);
  const investments = parseBigInt('Investments', investmentsStr);
  const pnl = parseBigInt('PnL', pnlStr);

  console.log('');
  console.log(paint(`Updating userId=${userId.toString()} from wallet ${walletIndex} ...`, 'yellow'));
  const tx = await contract.updateUser(userId, investments, pnl);
  console.log('');
  console.log(paint('Transaction Submitted', 'green'));
  console.log(`Hash: ${tx.hash}`);

  const receipt = await tx.wait();
  console.log('');
  console.log(paintBold('Transaction Receipt'));
  console.log(`Block number: ${receipt.blockNumber}`);
  console.log(`Gas used: ${receipt.gasUsed}`);

  lastWriteInput.userId = userIdStr;
  lastWriteInput.investments = investmentsStr;
  lastWriteInput.pnl = pnlStr;

  await decodeReceiptEvents(contract, receipt);
}

async function readFlow(
  rl: ReturnType<typeof createInterface> | undefined,
  input?: { userId: string }
) {
  const contractAddress = await ensureContractAddress(rl);
  const rpcUrl = await ensureRpcUrl(rl);

  const provider = createProvider(rpcUrl);
  const contract = new ethers.Contract(contractAddress, artifact.abi, provider);

  const userIdStr = input?.userId ?? (await askNonEmpty(rl!, 'User ID (uint256): '));
  const userId = parseBigInt('User ID', userIdStr);

  console.log('');
  console.log(paint(`Reading userId=${userId.toString()} ...`, 'yellow'));
  const [owner, returnedUserId, investments, pnl] = await contract.getUser(userId);

  console.log('');
  console.log(paintBold('User Snapshot'));
  console.log(`Owner: ${owner}`);
  console.log(`User ID: ${returnedUserId.toString()}`);
  console.log(`Investments: ${investments.toString()}`);
  console.log(`PnL: ${pnl.toString()}`);
}

async function interactiveMenu() {
  dotenv.config({ path: ENV_PATH });
  const canPrompt = Boolean(process.stdin.isTTY);
  if (!canPrompt) throw new Error('No TTY detected. Please run `npm run cli -- <command>` or set up .env.');

  printBanner();
  printConfigSummary();

  const rl = createInterface({ input, output });
  try {
    while (true) {
      printMenu();

      const choice = (await rl.question('Choose an option (1-5): ')).trim();
      try {
        if (choice === '1') {
          const walletIndex = await selectWallet(rl);
          await deployFlow(rl, walletIndex);
        } else if (choice === '2') {
          const walletIndex = await selectWallet(rl);
          await registerFlow(rl, walletIndex);
        } else if (choice === '3') {
          const walletIndex = await selectWallet(rl);
          await updateFlow(rl, walletIndex);
        } else if (choice === '4') {
          await readFlow(rl);
        } else if (choice === '5') {
          break;
        } else {
          console.log('Invalid choice. Please select 1-5.');
        }
      } catch (error) {
        console.log('');
        console.log(paint(`Error: ${getErrorReason(error)}`, 'red'));
      }
    }
  } finally {
    rl.close();
  }
}

async function runFromArgs() {
  dotenv.config({ path: ENV_PATH });
  const argv = process.argv.slice(2);
  const cmd = argv[0];

  const canPrompt = Boolean(process.stdin.isTTY);
  const rl = cmd && canPrompt ? createInterface({ input, output }) : undefined;

  try {
    const userId = getArgValue(argv, 'userId');
    const investments = getArgValue(argv, 'investments');
    const pnl = getArgValue(argv, 'pnl');

    if (cmd === 'deploy') {
      const walletIndexRaw = getArgValue(argv, 'wallet');
      const walletIndex = (walletIndexRaw === '2' ? 2 : 1) as WalletIndex;
      await deployFlow(rl, walletIndex);
      return;
    }

    if (cmd === 'register') {
      const walletIndexRaw = getArgValue(argv, 'wallet');
      const walletIndex = (walletIndexRaw === '2' ? 2 : 1) as WalletIndex;
      if (!userId || !investments || !pnl) {
        throw new Error('Missing required flags: --userId, --investments, --pnl');
      }
      await registerFlow(rl, walletIndex, { userId, investments, pnl });
      return;
    }

    if (cmd === 'update') {
      const walletIndexRaw = getArgValue(argv, 'wallet');
      const walletIndex = (walletIndexRaw === '2' ? 2 : 1) as WalletIndex;
      if (!userId || !investments || !pnl) {
        throw new Error('Missing required flags: --userId, --investments, --pnl');
      }
      await updateFlow(rl, walletIndex, { userId, investments, pnl });
      return;
    }

    if (cmd === 'read') {
      if (!userId) throw new Error('Missing required flag: --userId');
      await readFlow(rl, { userId });
      return;
    }

    console.log('');
    console.log('Usage:');
    console.log('  npm run cli -- deploy --wallet 1|2');
    console.log('  npm run cli -- register --wallet 1|2 --userId <id> --investments <n> --pnl <n>');
    console.log('  npm run cli -- update --wallet 1|2 --userId <id> --investments <n> --pnl <n>');
    console.log('  npm run cli -- read --userId <id>');
    console.log('');
    console.log('Or run `npm run cli` for the interactive menu.');
  } finally {
    rl?.close();
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    await interactiveMenu();
    return;
  }
  await runFromArgs();
}

main().catch((err) => {
  console.error(paint(`Error: ${getErrorReason(err)}`, 'red'));
  process.exit(1);
});

