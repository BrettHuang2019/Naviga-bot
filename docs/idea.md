
this is a prototype, do not over engineer.

an CLI tool that let user define some workflows to navigate a website for date query or edit. 

happy path:  1st time only entry point, run and generate manifest, user write the 1st config: login with username and password.  run again, it lands on the dashboard page, save manifest, user coninute write 2nd config: go to subscription page. etc. and that's how he works.

entry point, user name and password should be in .env. 

user write in workflow txt, AI will generate real config (yaml?) for real in used by ts.

it's a CLI app, user will keep modifying a same file, when run the cli, it auto detects if text file align with the config file, if not, go generate, if yes, run the workflow.

we need headless=false to show the website visually. 
do not close the webpage when workflow ends.