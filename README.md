## Go CPG explorer
To start the project, you need a Docker Desktop of Colima installed. (Personally I use Colima).
Just run`docker compose up` in a root folder and open [http://localhost:5173/](http://localhost:5173/) in a browser, that should be enough. 
The data itself is stored in a *cp_graph.db* file, which is too big to be stored in a repository, you won’t be able to run this without that file

## app notes
To be honest, the most complicated task for me here was figuring out how to properly install an additional module, compile the database etc.
Understanding the data structure and the ways of dealing with it took a long time as well. I tried reading the source documentation for CPG, but eventually I felt that truly understanding and figuring out an interesting way of dealing with it is not realistic in a given timeframe.
So I decided to make choices based upon the user experience. 
As a coder you don’t start with the function, you start with reading the code itself. 
So the first task was to render a .go file.
The next step was to add a section for a file browser.
After that I’ve created an endpoint using a non-standard query which listed all the functions in a given file. 
First I used that to just highlight the functions, later to make them clickable. 
The first version of a node traversal section was static and ugly, it’s still rather ugly, I’m afraid, but at least it’s better-looking. 
I use deep traversal as an option, but to be honest it doesn’t feel that necessary in this case. When you click a function node, you jump to a corresponding place in a source file.
This way you move through a codebase both in a linear way and through the graphs. 
I wish I didn’t start working on this so late into the day. This doesn’t look suitable for real-life use now, but if you fix the UI, this actually looks like a useful tool.