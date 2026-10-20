const app = require('./src/app');
const PORT = process.env.PORT || 3000

app.listen(PORT,async()=>{
    console.log(`server is running at ${PORT}`);   
})