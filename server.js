const app = require('./src/app');
const PORT = 3000 || process.env.PORT

app.listen(PORT,async()=>{
    console.log(`server is running at ${PORT}`);   
})