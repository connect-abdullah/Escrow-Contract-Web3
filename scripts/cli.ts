import { ethers } from 'ethers';
import * as dotenv from 'dotenv';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const artifact = JSON.parse(
  fs.readFileSync(
    path.resolve(process.cwd(), 'artifacts/contracts/EscrowContract.sol/EscrowContract.json'),
    'utf8'
  )
);

const STATUS = ['EMPTY', 'FUNDED', 'RELEASED', 'REFUNDED'] as const;

const ENV_PATH = path.resolve(process.cwd(), '.env');
const IS_TTY = Boolean(process.stdout.isTTY);

const COLOR = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
  magenta: '\x1b[35m',
  bold: '\x1b[1m',
};

let lastEscrowId: string | undefined;
let lastAmount: string | undefined;

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
  if (!v) return paint('(missing)', 'red');
  if (v.length <= 12) return `${v.slice(0, 2)}...${v.slice(-2)}`;
  return `${v.slice(0, 6)}...${v.slice(-4)}`;
}

function printBanner() {
  console.log('');
  console.log(paint('======================================', 'cyan'));
  console.log(paintBold('   Escrow Contract CLI'));
  console.log(paint('======================================', 'cyan'));
}

function printConfigSummary() {
  const rpcUrl = process.env.RPC_URL?.trim();
  const contractAddress = process.env.CONTRACT_ADDRESS?.trim();
  const buyerKey = process.env.BUYER_PRIVATE_KEY?.trim();
  const sellerKey = process.env.SELLER_PRIVATE_KEY?.trim();

  console.log('');
  console.log(paintBold('Configuration'));
  console.log(paint('--------------------------------------', 'gray'));
  console.log(`${paint('Buyer PK:', 'gray')}  ${maskSecret(buyerKey)}`);
  console.log(`${paint('Seller PK:', 'gray')} ${maskSecret(sellerKey)}`);
  console.log(
    `${paint('Contract:', 'gray')}  ${contractAddress && isProbablyAddress(contractAddress) ? contractAddress : paint('(missing)', 'red')}`
  );
  console.log(`${paint('RPC_URL:', 'gray')}   ${rpcUrl || paint('(missing)', 'red')}`);
  console.log(paint('--------------------------------------', 'gray'));
}

function printMenu() {
  console.log('');
  console.log(paintBold('Choose an option:'));
  console.log(`  ${paint('1)', 'cyan')} Deploy contract`);
  console.log(`  ${paint('2)', 'cyan')} Create escrow`);
  console.log(`  ${paint('3)', 'cyan')} Escrow transactions`);
  console.log(`  ${paint('4)', 'cyan')} Read escrow`);
  console.log(`  ${paint('5)', 'cyan')} Exit`);
}

function printTxMenu() {
  console.log('');
  console.log(paintBold('Escrow transactions:'));
  console.log(`  ${paint('1)', 'cyan')} Deposit funds`);
  console.log(`  ${paint('2)', 'cyan')} Release funds`);
  console.log(`  ${paint('3)', 'cyan')} Refund funds`);
  console.log(`  ${paint('4)', 'cyan')} Back`);
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
    console.log(paint('Please enter a value.', 'yellow'));
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

async function ensureBuyerPrivateKey(rl?: ReturnType<typeof createInterface>) {
  const existing = process.env.BUYER_PRIVATE_KEY?.trim();
  if (existing) return existing;

  if (!rl) {
    throw new Error('BUYER_PRIVATE_KEY is missing. Set BUYER_PRIVATE_KEY in .env.');
  }

  const next = await askNonEmpty(rl, 'Enter BUYER_PRIVATE_KEY: ');
  upsertEnvVar('BUYER_PRIVATE_KEY', next);
  return next;
}

async function ensureSellerPrivateKey(rl?: ReturnType<typeof createInterface>) {
  const existing = process.env.SELLER_PRIVATE_KEY?.trim();
  if (existing) return existing;

  if (!rl) {
    throw new Error('SELLER_PRIVATE_KEY is missing. Set SELLER_PRIVATE_KEY in .env.');
  }

  const next = await askNonEmpty(rl, 'Enter SELLER_PRIVATE_KEY: ');
  upsertEnvVar('SELLER_PRIVATE_KEY', next);
  return next;
}

async function ensureContractAddress(rl?: ReturnType<typeof createInterface>) {
  const contractAddress = process.env.CONTRACT_ADDRESS?.trim();
  if (contractAddress && isProbablyAddress(contractAddress)) return contractAddress;

  if (!rl) throw new Error('CONTRACT_ADDRESS is not set. Deploy first or set CONTRACT_ADDRESS in .env.');

  const answer = (await rl.question('CONTRACT_ADDRESS is missing. Deploy now? (y/N): '))
    .trim()
    .toLowerCase();

  if (answer === 'y' || answer === 'yes') {
    await deployFlow(rl);
    const deployed = process.env.CONTRACT_ADDRESS?.trim();
    if (!deployed || !isProbablyAddress(deployed)) {
      throw new Error('Deployment finished, but CONTRACT_ADDRESS was not set correctly.');
    }
    return deployed;
  }

  throw new Error('Cannot continue without CONTRACT_ADDRESS.');
}

async function getBuyerContract(rl?: ReturnType<typeof createInterface>) {
  const contractAddress = await ensureContractAddress(rl);
  const rpcUrl = await ensureRpcUrl(rl);
  const privateKey = await ensureBuyerPrivateKey(rl);

  const provider = createProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const contract = new ethers.Contract(contractAddress, artifact.abi, wallet);

  return { provider, wallet, contract, contractAddress };
}

async function deployFlow(rl?: ReturnType<typeof createInterface>) {
  const rpcUrl = await ensureRpcUrl(rl);
  const privateKey = await ensureBuyerPrivateKey(rl);

  const provider = createProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);

  console.log('');
  console.log(paint(`Deploying from buyer: ${wallet.address} ...`, 'yellow'));
  const contractTx = await factory.deploy();
  await contractTx.waitForDeployment();

  const contractAddress = await contractTx.getAddress();
  console.log('');
  console.log(paint('------------------- Deployment Success -------------------', 'green'));
  console.log(`${paint('Deployer:', 'gray')} ${wallet.address}`);
  console.log(`${paint('Contract:', 'gray')} ${contractAddress}`);

  upsertEnvVar('CONTRACT_ADDRESS', contractAddress);
  console.log(paint('CONTRACT_ADDRESS updated in .env', 'green'));
}

async function createEscrowFlow(
  rl?: ReturnType<typeof createInterface>,
  input?: { escrowId: string }
) {
  const { wallet, contract } = await getBuyerContract(rl);
  const sellerKey = await ensureSellerPrivateKey(rl);
  const sellerWallet = new ethers.Wallet(sellerKey);

  const escrowIdStr =
    input?.escrowId ?? (await askWithDefault(rl!, 'Escrow ID (uint256)', lastEscrowId));
  const escrowId = parseBigInt('Escrow ID', escrowIdStr);

  console.log('');
  console.log(
    paint(`Fetched seller address from .env: ${sellerWallet.address}`, 'green')
  );

  console.log('');
  console.log(
    paint(`Creating escrowId=${escrowId.toString()} from buyer ${wallet.address} ...`, 'yellow')
  );

  const tx = await contract.createEscrow(escrowId, sellerWallet.address);
  const receipt = await tx.wait();

  console.log('');
  console.log(paint('------------------- Escrow Created -------------------', 'green'));
  console.log(`${paint('Buyer:', 'gray')}            ${wallet.address}`);
  console.log(`${paint('Seller:', 'gray')}           ${sellerWallet.address}`);
  console.log(`${paint('Transaction Hash:', 'gray')} ${tx.hash}`);
  console.log(`${paint('Block Number:', 'gray')}     ${receipt?.blockNumber}`);
  console.log(`${paint('Gas Used:', 'gray')}         ${receipt?.gasUsed?.toString()}`);

  lastEscrowId = escrowIdStr;

  for (const log of receipt?.logs ?? []) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed?.name === 'EscrowCreated') {
        console.log('');
        console.log(paintBold('Event: EscrowCreated'));
        console.log(`  Escrow ID: ${parsed.args.escrowId.toString()}`);
        console.log(`  Buyer:     ${parsed.args.buyer}`);
        console.log(`  Seller:    ${parsed.args.seller}`);
      }
    } catch {
      // ignore non-matching logs
    }
  }
}

async function depositFlow(
  rl?: ReturnType<typeof createInterface>,
  input?: { escrowId: string; amount: string }
) {
  const { provider, wallet, contract } = await getBuyerContract(rl);
  const sellerKey = await ensureSellerPrivateKey(rl);
  const sellerWallet = new ethers.Wallet(sellerKey);

  const escrowIdStr =
    input?.escrowId ?? (await askWithDefault(rl!, 'Escrow ID (uint256)', lastEscrowId));
  const amountStr =
    input?.amount ?? (await askWithDefault(rl!, 'Amount (ETH)', lastAmount ?? '1'));

  const escrowId = parseBigInt('Escrow ID', escrowIdStr);
  let value: bigint;
  try {
    value = ethers.parseEther(amountStr);
  } catch {
    throw new Error(`Amount must be a valid ETH value. Got: ${amountStr}`);
  }
  if (value <= 0n) throw new Error('Amount must be greater than 0');

  console.log('');
  console.log(
    paint(
      `Depositing ${amountStr} ETH into escrowId=${escrowId.toString()} ...`,
      'yellow'
    )
  );

  const tx = await contract.depositFunds(escrowId, { value });
  console.log(`${paint('Transaction hash:', 'gray')} ${tx.hash}`);

  const receipt = await tx.wait();

  console.log('');
  console.log(paint('------------------- Funds Deposited -------------------', 'green'));
  console.log(`${paint('Buyer:', 'gray')}        ${wallet.address}`);
  console.log(`${paint('Seller:', 'gray')}       ${sellerWallet.address}`);
  console.log(`${paint('Block Number:', 'gray')} ${receipt?.blockNumber}`);
  console.log(`${paint('Gas Used:', 'gray')}     ${receipt?.gasUsed?.toString()}`);

  for (const log of receipt?.logs ?? []) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed?.name === 'FundsFunded') {
        console.log(`${paint('Escrow ID:', 'gray')}    ${parsed.args.escrowId.toString()}`);
        console.log(
          `${paint('Amount:', 'gray')}       ${ethers.formatEther(parsed.args.amount)} ETH`
        );
      }
    } catch {
      // ignore
    }
  }

  const buyerBalance = await provider.getBalance(wallet.address);
  console.log(
    `${paint('Buyer Wallet Balance:', 'gray')} ${ethers.formatEther(buyerBalance)} ETH`
  );

  lastEscrowId = escrowIdStr;
  lastAmount = amountStr;
}

async function releaseFlow(
  rl?: ReturnType<typeof createInterface>,
  input?: { escrowId: string }
) {
  const { provider, wallet, contract } = await getBuyerContract(rl);
  const sellerKey = await ensureSellerPrivateKey(rl);
  const sellerWallet = new ethers.Wallet(sellerKey);

  const escrowIdStr =
    input?.escrowId ?? (await askWithDefault(rl!, 'Escrow ID (uint256)', lastEscrowId));
  const escrowId = parseBigInt('Escrow ID', escrowIdStr);

  console.log('');
  console.log(
    paint(`Releasing funds for escrowId=${escrowId.toString()} ...`, 'yellow')
  );

  const tx = await contract.releaseFunds(escrowId);
  console.log(`${paint('Transaction hash:', 'gray')} ${tx.hash}`);

  const receipt = await tx.wait();

  console.log('');
  console.log(paint('------------------- Funds Released -------------------', 'green'));
  console.log(`${paint('Buyer:', 'gray')}        ${wallet.address}`);
  console.log(`${paint('Seller:', 'gray')}       ${sellerWallet.address}`);
  console.log(`${paint('Block Number:', 'gray')} ${receipt?.blockNumber}`);
  console.log(`${paint('Gas Used:', 'gray')}     ${receipt?.gasUsed?.toString()}`);

  for (const log of receipt?.logs ?? []) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed?.name === 'FundsReleased') {
        console.log(`${paint('Escrow ID:', 'gray')}    ${parsed.args.escrowId.toString()}`);
        console.log(
          `${paint('Amount:', 'gray')}       ${ethers.formatEther(parsed.args.amount)} ETH`
        );
      }
    } catch {
      // ignore
    }
  }

  const sellerBalance = await provider.getBalance(sellerWallet.address);
  console.log(
    `${paint('Seller Wallet Balance:', 'gray')} ${ethers.formatEther(sellerBalance)} ETH`
  );

  lastEscrowId = escrowIdStr;
}

async function refundFlow(
  rl?: ReturnType<typeof createInterface>,
  input?: { escrowId: string }
) {
  const { provider, wallet, contract } = await getBuyerContract(rl);
  const sellerKey = await ensureSellerPrivateKey(rl);
  const sellerWallet = new ethers.Wallet(sellerKey);

  const escrowIdStr =
    input?.escrowId ?? (await askWithDefault(rl!, 'Escrow ID (uint256)', lastEscrowId));
  const escrowId = parseBigInt('Escrow ID', escrowIdStr);

  console.log('');
  console.log(
    paint(`Refunding funds for escrowId=${escrowId.toString()} ...`, 'yellow')
  );

  const tx = await contract.refundFunds(escrowId);
  console.log(`${paint('Transaction hash:', 'gray')} ${tx.hash}`);

  const receipt = await tx.wait();

  console.log('');
  console.log(paint('------------------- Funds Refunded -------------------', 'green'));
  console.log(`${paint('Buyer:', 'gray')}        ${wallet.address}`);
  console.log(`${paint('Seller:', 'gray')}       ${sellerWallet.address}`);
  console.log(`${paint('Block Number:', 'gray')} ${receipt?.blockNumber}`);
  console.log(`${paint('Gas Used:', 'gray')}     ${receipt?.gasUsed?.toString()}`);

  for (const log of receipt?.logs ?? []) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed?.name === 'FundsRefunded') {
        console.log(`${paint('Escrow ID:', 'gray')}    ${parsed.args.escrowId.toString()}`);
        console.log(
          `${paint('Amount:', 'gray')}       ${ethers.formatEther(parsed.args.amount)} ETH`
        );
      }
    } catch {
      // ignore
    }
  }

  const buyerBalance = await provider.getBalance(wallet.address);
  console.log(
    `${paint('Buyer Wallet Balance:', 'gray')} ${ethers.formatEther(buyerBalance)} ETH`
  );

  lastEscrowId = escrowIdStr;
}

async function readFlow(
  rl?: ReturnType<typeof createInterface>,
  input?: { escrowId: string }
) {
  const contractAddress = await ensureContractAddress(rl);
  const rpcUrl = await ensureRpcUrl(rl);

  const provider = createProvider(rpcUrl);
  const contract = new ethers.Contract(contractAddress, artifact.abi, provider);

  const escrowIdStr =
    input?.escrowId ?? (await askWithDefault(rl!, 'Escrow ID (uint256)', lastEscrowId));
  const escrowId = parseBigInt('Escrow ID', escrowIdStr);

  console.log('');
  console.log(paint(`Reading escrowId=${escrowId.toString()} ...`, 'yellow'));

  const escrow = await contract.getEscrow(escrowId);

  console.log('');
  console.log(paint('------------------- Escrow Details -------------------', 'green'));
  console.log(`${paint('Escrow ID:', 'gray')} ${escrow.escrowId.toString()}`);
  console.log(`${paint('Buyer:', 'gray')}     ${escrow.buyer}`);
  console.log(`${paint('Seller:', 'gray')}    ${escrow.seller}`);
  console.log(`${paint('Amount:', 'gray')}    ${ethers.formatEther(escrow.amount)} ETH`);
  console.log(
    `${paint('Status:', 'gray')}    ${STATUS[Number(escrow.status)] ?? escrow.status.toString()}`
  );
  console.log(`${paint('Exists:', 'gray')}    ${escrow.exists}`);

  console.log('');
  console.log(paint('------------------- Balance -------------------', 'magenta'));
  console.log(
    `${paint('Buyer Balance:', 'gray')}  ${ethers.formatEther(await provider.getBalance(escrow.buyer))} ETH`
  );
  console.log(
    `${paint('Seller Balance:', 'gray')} ${ethers.formatEther(await provider.getBalance(escrow.seller))} ETH`
  );

  lastEscrowId = escrowIdStr;
}

async function escrowTransactionsMenu(rl: ReturnType<typeof createInterface>) {
  while (true) {
    printTxMenu();
    const choice = (await rl.question('Choose an option (1-4): ')).trim();
    try {
      if (choice === '1') {
        await depositFlow(rl);
      } else if (choice === '2') {
        await releaseFlow(rl);
      } else if (choice === '3') {
        await refundFlow(rl);
      } else if (choice === '4') {
        return;
      } else {
        console.log(paint('Invalid choice. Please select 1-4.', 'yellow'));
      }
    } catch (error) {
      console.log('');
      console.log(paint(`Error: ${getErrorReason(error)}`, 'red'));
    }
  }
}

async function interactiveMenu() {
  dotenv.config({ path: ENV_PATH });
  const canPrompt = Boolean(process.stdin.isTTY);
  if (!canPrompt) {
    throw new Error('No TTY detected. Please run `npm run cli -- <command>` or set up .env.');
  }

  printBanner();
  printConfigSummary();

  const rl = createInterface({ input, output });
  try {
    while (true) {
      printMenu();

      const choice = (await rl.question('Choose an option (1-5): ')).trim();
      try {
        if (choice === '1') {
          await deployFlow(rl);
          printConfigSummary();
        } else if (choice === '2') {
          await createEscrowFlow(rl);
        } else if (choice === '3') {
          await escrowTransactionsMenu(rl);
        } else if (choice === '4') {
          await readFlow(rl);
        } else if (choice === '5') {
          console.log('');
          console.log(paint('Goodbye!', 'cyan'));
          break;
        } else {
          console.log(paint('Invalid choice. Please select 1-5.', 'yellow'));
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

function printUsage() {
  console.log('');
  console.log(paintBold('Usage:'));
  console.log('  npm run cli -- deploy');
  console.log('  npm run cli -- create --escrowId <id>');
  console.log('  npm run cli -- deposit --escrowId <id> --amount <eth>');
  console.log('  npm run cli -- release --escrowId <id>');
  console.log('  npm run cli -- refund --escrowId <id>');
  console.log('  npm run cli -- read --escrowId <id>');
  console.log('');
  console.log('Or run `npm run cli` for the interactive menu.');
}

async function runFromArgs() {
  dotenv.config({ path: ENV_PATH });
  const argv = process.argv.slice(2);
  const cmd = argv[0];

  const canPrompt = Boolean(process.stdin.isTTY);
  const rl = cmd && canPrompt ? createInterface({ input, output }) : undefined;

  try {
    const escrowId = getArgValue(argv, 'escrowId');
    const amount = getArgValue(argv, 'amount');

    if (cmd === 'deploy') {
      await deployFlow(rl);
      return;
    }

    if (cmd === 'create') {
      if (!escrowId) throw new Error('Missing required flag: --escrowId');
      await createEscrowFlow(rl, { escrowId });
      return;
    }

    if (cmd === 'deposit') {
      if (!escrowId || !amount) {
        throw new Error('Missing required flags: --escrowId, --amount');
      }
      await depositFlow(rl, { escrowId, amount });
      return;
    }

    if (cmd === 'release') {
      if (!escrowId) throw new Error('Missing required flag: --escrowId');
      await releaseFlow(rl, { escrowId });
      return;
    }

    if (cmd === 'refund') {
      if (!escrowId) throw new Error('Missing required flag: --escrowId');
      await refundFlow(rl, { escrowId });
      return;
    }

    if (cmd === 'read') {
      if (!escrowId) throw new Error('Missing required flag: --escrowId');
      await readFlow(rl, { escrowId });
      return;
    }

    printUsage();
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
