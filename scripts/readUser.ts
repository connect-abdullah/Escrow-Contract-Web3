import { ethers } from 'ethers';
import dotenv from 'dotenv';
import artifact from '../artifacts/contracts/UserRegistry.sol/UserRegistry.json';

dotenv.config();

const rpcUrl = process.env.RPC_URL;
const contractAddress = process.env.CONTRACT_ADDRESS;

if (!rpcUrl || !contractAddress) {
    throw new Error('RPC_URL or CONTRACT_ADDRESS is not set');
}

const provider = new ethers.JsonRpcProvider(rpcUrl);

const contract = new ethers.Contract(contractAddress, artifact.abi, provider);

const main = async () => {
    const [owner, userId, investments, pnl] = await contract.getUser(2); // wait for the transaction to be mined.

    console.log(`Owner: ${owner}`);
    console.log(`User ID: ${userId}`);
    console.log(`Investments: ${investments}`);
    console.log(`PnL: ${pnl}`);
}

main().catch(console.error);

