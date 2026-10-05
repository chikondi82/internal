const express = require('express');
const path = require('path');

const app = express();
const PORT = 3000;

// Serve all files in this folder
app.use(express.static(__dirname));

// Start server
app.listen(PORT, () => {
    console.log(`Internal app running at http://localhost:${PORT}`);
});