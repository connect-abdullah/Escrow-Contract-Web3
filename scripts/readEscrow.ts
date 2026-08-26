import { ethers } from 'ethers';
import dotenv from 'dotenv';
import artifact from '../artifacts/contracts/EscrowContract.sol/EscrowContract.json';

dotenv.config();

const rpcUrl = process.env.RPC_URL;
const contractAddress = process.env.CONTRACT_ADDRESS;

if (!contractAddress || !rpcUrl) {
    throw new Error('CONTRACT_ADDRESS or RPC_URL is not set');
}

const provider = new ethers.JsonRpcProvider(rpcUrl);

const contract = new ethers.Contract(contractAddress, artifact.abi, provider);

const STATUS = ['EMPTY', 'FUNDED', 'RELEASED', 'REFUNDED'];

const main = async () => {
    try {
        // Escrow struct: escrowId, buyer, seller, amount, status, exists
        const escrow = await contract.getEscrow(1);

        console.log("------------------- Escrow Details -------------------");
        console.log("Escrow ID:", escrow.escrowId.toString());
        console.log("Buyer:", escrow.buyer);
        console.log("Seller:", escrow.seller);
        console.log("Amount:", ethers.formatEther(escrow.amount), "ETH");
        console.log("Status:", STATUS[Number(escrow.status)] ?? escrow.status.toString());
        console.log("Exists:", escrow.exists);

        // Get balance of buyer and seller
        console.log("\n");
        console.log("------------------- Balance -------------------");
        console.log("Buyer Balance:", ethers.formatEther(await provider.getBalance(escrow.buyer)), "ETH");
        console.log("Seller Balance:", ethers.formatEther(await provider.getBalance(escrow.seller)), "ETH");
    } catch (error: any) {
        return console.error("Error: ", error?.reason || error?.shortMessage || error?.message);
    }
}

main().catch(console.error);
