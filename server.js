import express from "express";
import './models/db.js';

const app =express();
const port = 3000;

//Routes
app.get('/', (req, res) => {
    res.render("index.ejs");
});


app.get("/user/profile", (req, res)=>{
    res.render("user/profile.ejs");
});

app.listen(port, ()=>{
    console.log(`Server running on port ${port}`);
});