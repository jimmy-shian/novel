// game state variables
let gameBoard = ["", "", "", "", "", "", "", "", ""];
let turn = "O";
let gameOver = false;
let moves = 0;
let startTime;

// winning combinations
const combinations = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6]
];

// update game state when a box is clicked
const boxClicked = (index) => {
  // do not allow moves on a filled box or after game is over
  if (gameBoard[index] || gameOver) return;
  
  gameBoard[index] = turn;
  moves++;
  
  // update game board
  document.getElementById(index).innerHTML = turn;
  
  // check for win
  for (let i = 0; i < combinations.length; i++) {
    const [a, b, c] = combinations[i];
    if (gameBoard[a] === turn && gameBoard[b] === turn && gameBoard[c] === turn) {
      gameOver = true;
      displayMessage(`${turn} wins!`);
      return;
    }
  }
  
  // check for draw
  if (moves === 9) {
    gameOver = true;
    displayMessage("It's a draw.");
    return;
  }
  
  // switch turn
  turn = turn === "O" ? "X" : "O";
  displayMessage(`${turn}'s turn.`);
};

// display message to user
const displayMessage = (message) => {
  document.getElementById("message").innerHTML = message;
};

// reset game
const reset = () => {
  gameBoard = ["", "", "", "", "", "", "", "", ""];
  turn = "O";
  gameOver = false;
  moves = 0;
  startTime = new Date();
  for (let i = 0; i < 9; i++) {
    document.getElementById(i).innerHTML = "";
  }
  displayMessage(`${turn} starts.`);
};

// start game
reset();
