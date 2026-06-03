const router = require("express").Router();

const auth = require("../middleware/auth");

const {
createStore,
getStores
}
= require("../controllers/storeController");

router.post("/",auth,createStore);
router.get("/",getStores);

module.exports = router;