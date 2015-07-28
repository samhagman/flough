# Mongo and Mongoose Module FAQ

- How do Mongoose models get their name?

The mongo/index.js file will load all the files in the mongo/models/ folder as Mongoose models.  Each file
inside the models folder should return a mongoose Schema.  The index.js file will create a Mongoose model
and MongoDB collection that are the .toLowerCase()'d name of the model file.  (Person.js ==> 'person')

- Why go through all this trouble with naming Mongoose Models and MongoDB collections?

We do this to keep everything consistent across the project.
When using this technique,  `mongoose.model('filename') === mongoose.model('collection name') === mongoose.model('model name')`
Also, rather importantly, because the mongo oplog will report back collection names, it is ***VERY*** important that the collection name and the model name are the exact same so that we can
dynamically get the model to do operations on it based on logs in the oplog.  Check out the observer dir for a better picture of what is being done with the mongo oplog.