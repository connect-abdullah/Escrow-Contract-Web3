import { ethers } from 'ethers';
import dotenv from 'dotenv';
import artifact from '../artifacts/contracts/EscrowContract.sol/EscrowContract.json';

dotenv.config();

const rpcUrl = process.env.RPC_URL;
const buyerPrivateKey = process.env.BUYER_PRIVATE_KEY;
const contractAddress = process.env.CONTRACT_ADDRESS;
const sellerPrivateKey = process.env.SELLER_PRIVATE_KEY;

if (!buyerPrivateKey || !sellerPrivateKey || !rpcUrl) {
    throw new Error('PRIVATE_KEY or RPC_URL is not set');
}

const provider = new ethers.JsonRpcProvider(rpcUrl);
const buyerWallet = new ethers.Wallet(buyerPrivateKey, provider);
const sellerWallet = new ethers.Wallet(sellerPrivateKey, provider);

const contract = new ethers.Contract(contractAddress, artifact.abi, buyerWallet);

const main = async () => {
    try {
        const tx = await contract.createEscrow(1, sellerWallet.address);
        const receipt = await tx.wait();

        console.log("------------------- Escrow Created -------------------");
        console.log("Buyer:", buyerWallet.address);
        console.log("Seller:", sellerWallet.address);
        console.log("Transaction Hash:", tx.hash);
        console.log("Block Number:", receipt?.blockNumber);
        console.log("Gas Used:", receipt?.gasUsed);
        
    } catch (error: any) {
        return console.error("Error: ", error?.reason || error?.message);
    }
}

main().catch(console.error);

