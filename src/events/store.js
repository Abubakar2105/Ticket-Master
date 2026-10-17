const commandPrisma = require("../config/command-prisma");

const append = async(event,db=commandPrisma)=>{
   return await db.outboxEvent.create({
        data:{
            aggregateId:event.aggregateId,
            eventType:event.event_type,
            payload:event.payload
        }
    })
    
}


module.exports = {append}