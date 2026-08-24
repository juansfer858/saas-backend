const {prisma}=require('../../config/prisma');
async function pull(agent,limit=50){
  const orders=await prisma.edgeRemoteOrder.findMany({where:{edgeAgentId:agent.id,tenantId:agent.tenantId,state:'APPROVED',localOperationId:null},orderBy:{creadoEn:'asc'},take:Math.min(Math.max(Number(limit)||50,1),100)});
  if(!orders.length)return[];
  const channels=await prisma.edgeRemoteChannel.findMany({where:{id:{in:[...new Set(orders.map(x=>x.remoteChannelId))]},tenantId:agent.tenantId},select:{id:true,type:true,name:true,tableId:true}});
  const byId=new Map(channels.map(x=>[x.id,x]));
  return orders.map(x=>({...x,channel:byId.get(x.remoteChannelId)||null}));
}
module.exports={pull};
