import { ethers } from 'ethers';
import dotenv from 'dotenv';
import artifact from '../artifacts/contracts/EscrowContract.sol/EscrowContract.json';

dotenv.config();

const rpcUrl = process.env.RPC_URL;
const buyerPrivateKey = process.env.BUYER_PRIVATE_KEY;
const contractAddress = process.env.CONTRACT_ADDRESS;
const sellerPrivateKey = process.env.SELLER_PRIVATE_KEY;

if (!buyerPrivateKey || !sellerPrivateKey || !rpcUrl || !contractAddress) {
    throw new Error('BUYER_PRIVATE_KEY, SELLER_PRIVATE_KEY, RPC_URL or CONTRACT_ADDRESS is not set');
}

const provider = new ethers.JsonRpcProvider(rpcUrl);
const buyerWallet = new ethers.Wallet(buyerPrivateKey, provider);
const sellerWallet = new ethers.Wallet(sellerPrivateKey, provider);

const contract = new ethers.Contract(contractAddress, artifact.abi, buyerWallet);

async function deposit(escrowId: number) {
    try {
        const tx = await contract.depositFunds(escrowId, { value: ethers.parseEther('1') });
        console.log(`Transaction hash: ${tx.hash}`);

        const receipt = await tx.wait();

        console.log("------------------- Funds Deposited -------------------");
        console.log("Buyer:", buyerWallet.address);
        console.log("Seller:", sellerWallet.address);
        console.log("Block Number:", receipt?.blockNumber);
        console.log("Gas Used:", receipt?.gasUsed);

        for (const event of receipt?.logs) {
            const parsed = contract.interface.parseLog(event);
            if (parsed?.name === 'FundsFunded') {
                console.log("Escrow ID:", parsed?.args?.escrowId.toString());
                console.log("Amount:", ethers.formatEther(parsed?.args?.amount), "ETH");
            }
        }
        // Get buyer balance after deposit
        const buyerBalance = await provider.getBalance(buyerWallet.address);
        console.log("Buyer Wallet Balance:", ethers.formatEther(buyerBalance), "ETH");
    } catch (error: any) {
        return console.error("Error: ", error?.reason || error?.message);
    }
}

async function releaseFunds(escrowId: number) {
    try {
        const tx = await contract.releaseFunds(escrowId);
        console.log(`Transaction hash: ${tx.hash}`);

        const receipt = await tx.wait();

        console.log("------------------- Funds Released -------------------");
        console.log("Buyer:", buyerWallet.address);
        console.log("Seller:", sellerWallet.address);
        console.log("Block Number:", receipt?.blockNumber);
        console.log("Gas Used:", receipt?.gasUsed);

        for (const event of receipt?.logs) {
            const parsed = contract.interface.parseLog(event);
            if (parsed?.name === 'FundsReleased') {
                console.log("Escrow ID:", parsed?.args?.escrowId.toString());
                console.log("Amount:", ethers.formatEther(parsed?.args?.amount), "ETH");
            }
        }

        // Get seller balance
        const sellerBalance = await provider.getBalance(sellerWallet.address);
        console.log("Seller Wallet Balance:", ethers.formatEther(sellerBalance), "ETH");
    } catch (error: any) {
        return console.error("Error: ", error?.reason || error?.message);
    }
}

async function refund(escrowId: number) {
    try {
        const tx = await contract.refundFunds(escrowId);
        console.log(`Transaction hash: ${tx.hash}`);

        const receipt = await tx.wait();

        console.log("------------------- Funds Refunded -------------------");
        console.log("Buyer:", buyerWallet.address);
        console.log("Seller:", sellerWallet.address);
        console.log("Block Number:", receipt?.blockNumber);
        console.log("Gas Used:", receipt?.gasUsed);

        for (const event of receipt?.logs) {
            const parsed = contract.interface.parseLog(event);
            if (parsed?.name === 'FundsRefunded') {
                console.log("Escrow ID:", parsed?.args?.escrowId.toString());
                console.log("Amount:", ethers.formatEther(parsed?.args?.amount), "ETH");
            }
        }

        // Get buyer balance
        const buyerBalance = await provider.getBalance(buyerWallet.address);
        console.log("Buyer Wallet Balance:", ethers.formatEther(buyerBalance), "ETH");
    } catch (error: any) {
        return console.error("Error: ", error?.reason || error?.message);
    }
}

const main = async () => {
    const arg = process.argv[2];

    if (arg === 'deposit') {
        await deposit(1);
    } else if (arg === 'release') {
        await releaseFunds(1);
    } else if (arg === 'refund') {
        await refund(1);
    } else {
        console.error("Invalid argument. Use: deposit | release | refund");
        process.exit(1);
    }
}

main().catch(console.error);
