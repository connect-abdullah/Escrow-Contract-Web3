import { ethers } from 'ethers';
import dotenv from 'dotenv';
import artifact from '../artifacts/contracts/UserRegistry.sol/UserRegistry.json';

dotenv.config();

const rpcUrl = process.env.RPC_URL;
const privateKey = process.env.PRIVATE_KEY;
const contractAddress = process.env.CONTRACT_ADDRESS;

if (!privateKey || !rpcUrl) {
    throw new Error('PRIVATE_KEY or RPC_URL is not set');
}

const provider = new ethers.JsonRpcProvider(rpcUrl);
const wallet = new ethers.Wallet(privateKey, provider);

const contract = new ethers.Contract(contractAddress, artifact.abi, wallet);

const main = async () => {
    // check if the user already exists
    
    try {
        const tx = await contract.updateUser(2, 5000, 9000); // wait for the transaction to be mined.
        console.log(`Transaction hash: ${tx.hash}`);

        const receipt = await tx.wait(); // waits until the transaction is included in a block and returns the receipt.
    
        console.log("Deployer:", wallet.address);
        console.log(`Block number: ${receipt?.blockNumber}`);
        console.log(`Gas used: ${receipt?.gasUsed}`);
        // console.log(`Logs: ${JSON.stringify(receipt)}`);
    
        // log the events from the transaction.
        for (const event of receipt?.logs) {
            const parsed = contract.interface.parseLog(event);
            if (parsed?.name === 'UserUpdated') {
                console.log(`Owner: ${parsed?.args?.owner}`);
                console.log(`User updated: ${parsed?.args?.userId}`);
                console.log(`Investments: ${parsed?.args?.investments}`);
                console.log(`Pnl: ${parsed?.args?.pnl}`);
            }
        }
    } catch (error) {
        return console.error("Error: ", error?.reason || error?.message);
    }

   
}

main().catch(console.error);

