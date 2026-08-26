import { ethers } from 'ethers';
import dotenv from 'dotenv';
import artifact from '../artifacts/contracts/EscrowContract.sol/EscrowContract.json';

dotenv.config();

const rpcUrl = process.env.RPC_URL;
const privateKey = process.env.BUYER_PRIVATE_KEY;

if (!privateKey || !rpcUrl) {
    throw new Error('PRIVATE_KEY or RPC_URL is not set');
}

const provider = new ethers.JsonRpcProvider(rpcUrl);
const wallet = new ethers.Wallet(privateKey, provider);

const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);

const main = async () => {

    const tx = await factory.deploy();

    await tx.waitForDeployment();

    console.log("Deployer:", wallet.address);
    console.log("Contract:", await tx.getAddress());
}

main().catch(console.error);

