const express = require("express");
const router = express.Router();
const createPool = require("../db");

const jwt = require('jsonwebtoken');
const SECRET_KEY = 'your_secret_key'; 

const db = createPool();


const authenticateJWT = (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (authHeader) {
        const token = authHeader.split(' ')[1];

        jwt.verify(token, SECRET_KEY, (err, user) => {
            if (err) {
                return res.sendStatus(403);
            }

            req.userId = user.userId;
            next();
        });
    } else {
        res.sendStatus(401);
    }
};



router.post("/feedback/create",authenticateJWT, async (req, res) => {
    const { summary, areasOfImprovement, rating } = req.body;
    if (!summary)
        {
            return res.status(200).send({
                status: 200,
                is_error:true,
                message: 'summary is required.'
            });
           
        }
        if (!rating ) {
            return res.status(200).send({
                status: 200,
                is_error:true,
                message: 'rating is required.'
            });
        }
    let connection;
    try {
        connection = await db.getConnection();
        const userId = req.userId;

        const searchQuery = "SELECT * FROM users WHERE id = ?";
        const [searchResults] = await connection.query(searchQuery, [userId]);
        
        if (searchResults.length == 0) {
            return res.status(200).send({
                status: 200,
                is_error: true,
                message: 'User doesn\'t exist'
            });
        }

        
        const user = searchResults[0]

        
        if (user.parentId == 0) {
            return res.status(200).send({
                status: 200,
                is_error:true,
                message: "admin can't create feedbacks"
            });
        }

        const insertQuery = "insert into feedbacks (summary, areasOfImprovement, rating, userId, parentId) VALUES (?, ?, ?, ?, ?)";
        const [result] = await connection.query(insertQuery, [summary, areasOfImprovement, rating, user.id,user.parentId ]);
        
        return res.status(200).send({
            status: 200,
            is_error:false,
            message: "successfully created",
            createdId: result.insertId
        });
    } catch (error) {
        console.error("Error creating feedback form:", error.message);
        return res.status(200).send({
            status: 200,
            is_error:true,
            message: error.message
        });
    } finally {
        if (connection) {
            connection.release();
        }
    }
});



router.post("/feedback/list",authenticateJWT, async (req, res) => {
    
    let connection;
    try {
        connection = await db.getConnection();
        const userId = req.userId;

        const searchQuery = "SELECT * FROM users WHERE id = ?";
        const [searchResults] = await connection.query(searchQuery, [userId]);
        
        if (searchResults.length == 0) {
            return res.status(200).send({
                status: 200,
                is_error: true,
                message: 'User doesn\'t exist'
            });
        }

        
        const user = searchResults[0]
        var feedBackSearchQuery
        if(user.parentId ==0){
            feedBackSearchQuery = "SELECT feedbacks.*, users.email AS email FROM feedbacks JOIN users ON feedbacks.userId = users.id WHERE feedbacks.parentId = ?";
        }else{
            feedBackSearchQuery = "select feedbacks.*, users.email as email from feedbacks join users on feedbacks.userId = users.id where feedbacks.userId = ?";
        }
        const [feedbackSearchResults] = await connection.query(feedBackSearchQuery, [user.id]);
        return res.status(200).send({
            status: 200,
            is_error:false,
            message: "success",
            user: feedbackSearchResults
        });
    } catch (error) {
        console.error("Error fetchinh user:", error.message);
        return res.status(200).send({
            status: 200,
            is_error:true,
            message: error.message
        });
    } finally {
        if (connection) {
            connection.release();
        }
    }
});

const getUserByEmail = async (email) => {
    let connection;
    try {
        connection = await createPool().getConnection();
        const [users] = await connection.query("SELECT * FROM users WHERE email = ?", [email]);
        return users.length > 0 ? users[0] : null;
    } finally {
        if (connection) {
            connection.release();
        }
    }
};


module.exports = router;
